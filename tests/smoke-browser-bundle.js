"use strict";
(() => {
  // src/shared/semantics.ts
  var HINT_RULES = [
    { hint: "email", patterns: [/\bemail\b/i, /e-?mail/i] },
    { hint: "phone", patterns: [/\bphone/i, /\btel\b/i, /\bmobile\b/i, /\bcellphone/i] },
    { hint: "first_name", patterns: [/\bfirst[\s_-]*name\b/i, /\bgiven[\s_-]*name\b/i, /\bforename\b/i] },
    { hint: "last_name", patterns: [/\blast[\s_-]*name\b/i, /\bsurname\b/i, /\bfamily[\s_-]*name\b/i] },
    { hint: "full_name", patterns: [/\bfull[\s_-]*name\b/i, /\byour[\s_-]*name\b/i, /\bname\b/i] },
    { hint: "date_of_birth", patterns: [/\bdate[\s_-]*of[\s_-]*birth\b/i, /\bdob\b/i, /\bbirthday\b/i, /\bbirth[\s_-]*date\b/i] },
    { hint: "address_line_2", patterns: [/\baddress[\s_-]*(line[\s_-]*2|2)\b/i, /\bapt\b/i, /\bapartment\b/i, /\bsuite\b/i, /\bunit\b/i] },
    { hint: "address", patterns: [/\baddress\b/i, /\bstreet\b/i, /\baddr\b/i, /streetaddress/i] },
    { hint: "city", patterns: [/\bcity\b/i, /\btown\b/i, /\blocality\b/i] },
    { hint: "state", patterns: [/\bstate\b/i, /\bregion\b/i, /\bprovince\b/i] },
    { hint: "country", patterns: [/\bcountry\b/i, /\bnation\b/i] },
    { hint: "postal_code", patterns: [/\bpostal\b/i, /\bzip\b/i, /\bpostcode\b/i, /\bzip[\s_-]*code\b/i] },
    { hint: "username", patterns: [/\buser[\s_-]*name\b/i, /\blogin\b/i, /\bhandle\b/i, /\baccount[\s_-]*name\b/i] },
    { hint: "password", patterns: [/\bpassword\b/i, /\bpasswd\b/i, /\bpwd\b/i] },
    { hint: "search", patterns: [/\bsearch\b/i, /\bquery\b/i, /\bq\b/] },
    { hint: "url", patterns: [/\burl\b/i, /\bwebsite\b/i, /\bhomepage\b/i, /\bsite\b/i] },
    { hint: "number", patterns: [/\bnumber\b/i, /\bcount\b/i, /\bquantity\b/i, /\bamount\b/i, /\bage\b/i] },
    { hint: "date", patterns: [/\bdate\b/i] },
    { hint: "time", patterns: [/\btime\b/i, /\bhour\b/i] },
    { hint: "datetime", patterns: [/\bdate[\s_-]*time\b/i, /\bwhen\b/i, /\bscheduled\b/i] },
    { hint: "color", patterns: [/\bcolor\b/i, /\bcolour\b/i] },
    { hint: "range", patterns: [/\brange\b/i, /\bvolume\b/i, /\bslider\b/i] },
    { hint: "file", patterns: [/\bfile\b/i, /\bresume\b/i, /\bcv\b/i, /\bupload\b/i, /\battachment\b/i] }
  ];
  var AUTOCOMPLETE_HINTS = [
    { tokens: ["given-name"], hint: "first_name" },
    { tokens: ["family-name"], hint: "last_name" },
    { tokens: ["username"], hint: "username" },
    { tokens: ["current-password", "new-password"], hint: "password" },
    { tokens: ["street-address", "address-line1"], hint: "address" },
    { tokens: ["address-line2"], hint: "address_line_2" },
    { tokens: ["address-level2", "locality"], hint: "city" },
    { tokens: ["address-level1", "region"], hint: "state" },
    { tokens: ["country", "country-name"], hint: "country" },
    { tokens: ["postal-code"], hint: "postal_code" },
    { tokens: ["email"], hint: "email" },
    { tokens: ["tel", "phone"], hint: "phone" },
    { tokens: ["url"], hint: "url" },
    { tokens: ["bday", "birthday"], hint: "date_of_birth" },
    { tokens: ["name"], hint: "full_name" }
  ];
  function matchRules(input) {
    const fields = [
      { key: "aria-label", value: input.ariaLabel ?? "" },
      { key: "label", value: input.label ?? "" },
      { key: "placeholder", value: input.placeholder ?? "" },
      { key: "name", value: input.name ?? "" },
      { key: "id", value: input.id ?? "" }
    ];
    const sources = /* @__PURE__ */ new Set();
    for (const rule of HINT_RULES) {
      for (const f of fields) {
        if (!f.value) continue;
        for (const p of rule.patterns) {
          if (p.test(f.value)) {
            sources.add(f.key);
            return { hint: rule.hint, sources: Array.from(sources) };
          }
        }
      }
    }
    const ac = (input.autocomplete ?? "").toLowerCase().trim();
    if (ac) {
      for (const rule of AUTOCOMPLETE_HINTS) {
        for (const token of rule.tokens) {
          if (ac.includes(token)) {
            sources.add("autocomplete");
            return { hint: rule.hint, sources: Array.from(sources) };
          }
        }
      }
    }
    if (input.type === "email") return { hint: "email", sources: ["type"] };
    if (input.type === "tel") return { hint: "phone", sources: ["type"] };
    if (input.type === "url") return { hint: "url", sources: ["type"] };
    if (input.type === "password") return { hint: "password", sources: ["type"] };
    if (input.type === "search") return { hint: "search", sources: ["type"] };
    if (input.type === "number" || input.type === "range") return { hint: input.type, sources: ["type"] };
    if (input.type === "date") return { hint: "date", sources: ["type"] };
    if (input.type === "time") return { hint: "time", sources: ["type"] };
    if (input.type === "datetime-local" || input.type === "month" || input.type === "week") return { hint: "datetime", sources: ["type"] };
    if (input.type === "color") return { hint: "color", sources: ["type"] };
    if (input.type === "file") return { hint: "file", sources: ["type"] };
    if (input.type === "checkbox") return { hint: "checkbox_group", sources: ["type"] };
    if (input.type === "radio") return { hint: "radio_group", sources: ["type"] };
    return { hint: "unknown", sources: [] };
  }
  function inferSemanticHint(input) {
    return matchRules(input);
  }
  var SEMANTIC_HINTS = Object.freeze([
    "email",
    "phone",
    "first_name",
    "last_name",
    "full_name",
    "date_of_birth",
    "address",
    "address_line_2",
    "city",
    "state",
    "country",
    "postal_code",
    "username",
    "password",
    "search",
    "url",
    "number",
    "date",
    "time",
    "datetime",
    "color",
    "range",
    "file",
    "checkbox_group",
    "radio_group",
    "select_choice",
    "textarea",
    "unknown"
  ]);

  // src/content/detector.ts
  var SUPPORTED_INPUT_TYPES = /* @__PURE__ */ new Set([
    "text",
    "email",
    "password",
    "tel",
    "url",
    "search",
    "number",
    "date",
    "time",
    "datetime-local",
    "month",
    "week",
    "color",
    "range",
    "hidden",
    "checkbox",
    "radio",
    "file",
    "submit",
    "reset",
    "image",
    "button"
  ]);
  var SENSITIVE_INPUT_TYPES = /* @__PURE__ */ new Set(["password", "file"]);
  var NEVER_DISPLAY_VALUE_TYPES = /* @__PURE__ */ new Set(["password", "file"]);
  function isFormElement(node) {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return true;
    if (tag === "INPUT") {
      const type = (node.type ?? "text").toLowerCase();
      return SUPPORTED_INPUT_TYPES.has(type);
    }
    const role = node.getAttribute("role");
    if (role === "combobox" || role === "radio" || role === "checkbox") return true;
    return false;
  }
  function isCandidateControl(node) {
    if (!isFormElement(node)) return false;
    if (node.tagName === "INPUT") {
      const type = (node.type ?? "text").toLowerCase();
      if (type === "hidden") return false;
    }
    if (node.tagName === "BUTTON") {
      const btn = node;
      if (btn.type === "button" && !btn.hasAttribute("aria-label") && !(btn.textContent ?? "").trim()) {
        return true;
      }
    }
    return true;
  }
  function isSubmitControl(el) {
    if (el.tagName === "BUTTON") {
      const btn = el;
      if (btn.type === "submit" || btn.type === "button" || btn.type === "reset") return true;
      if (btn.type === "") return true;
    }
    if (el.tagName === "INPUT") {
      const t = el.type;
      if (t === "submit" || t === "image") return true;
    }
    return false;
  }
  function classifyInput(input) {
    const raw = (input.type || "text").toLowerCase();
    return SUPPORTED_INPUT_TYPES.has(raw) ? raw : "other";
  }
  function isElementVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }
  function extractSemanticContext(el, controlId, controlName) {
    if (controlId) {
      const explicit = document.querySelector(`label[for="${cssEscape(controlId)}"]`);
      if (explicit) {
        const text = (explicit.textContent ?? "").trim();
        if (text) return text;
      }
    }
    let parent = el.parentElement;
    while (parent) {
      if (parent.tagName === "LABEL") {
        const text = (parent.textContent ?? "").trim();
        if (text) return text;
      }
      parent = parent.parentElement;
    }
    const labelEl = el;
    if (labelEl.labels && labelEl.labels.length > 0) {
      const text = Array.from(labelEl.labels).map((l) => (l.textContent ?? "").trim()).filter(Boolean).join(" ");
      if (text) return text;
    }
    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const refs = ariaLabelledBy.split(/\s+/).map((refId) => document.getElementById(refId)).filter((n) => n !== null);
      const text = refs.map((r) => (r.textContent ?? "").trim()).join(" ");
      if (text) return text;
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) {
      return ariaLabel.trim();
    }
    parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 4) {
      if (parent.tagName === "FIELDSET") {
        const legend = parent.querySelector(":scope > legend");
        if (legend) {
          const text = (legend.textContent ?? "").trim();
          if (text) return text;
        }
        break;
      }
      parent = parent.parentElement;
      depth++;
    }
    if (el.previousElementSibling) {
      const text = (el.previousElementSibling.textContent ?? "").trim();
      if (text && text.length > 0 && text.length < 150) {
        return text;
      }
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) {
      return placeholder.trim();
    }
    if (controlName && controlName.trim()) {
      return controlName.trim();
    }
    if (controlId && controlId.trim()) {
      return controlId.trim();
    }
    return "";
  }
  function getAutocomplete(el) {
    return (el.getAttribute("autocomplete") ?? "").trim();
  }
  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    return false;
  }
  function isReadOnly(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.readOnly === true;
    }
    return false;
  }
  function getValuePresent(el) {
    if (NEVER_DISPLAY_VALUE_TYPES.has(el.tagName === "INPUT" ? el.type : "")) {
      return false;
    }
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio") return el.checked;
      return el.value.length > 0;
    }
    if (el instanceof HTMLTextAreaElement) {
      return el.value.length > 0;
    }
    if (el instanceof HTMLSelectElement) {
      return el.value.length > 0 && Array.from(el.options).some((o) => o.selected);
    }
    return false;
  }
  function containsSensitiveValue(el) {
    if (el.tagName === "INPUT") {
      const t = el.type;
      return SENSITIVE_INPUT_TYPES.has(t);
    }
    return false;
  }
  function extractOptions(select) {
    const opts = [];
    for (const o of Array.from(select.options)) {
      opts.push({
        value: o.value,
        text: (o.textContent ?? "").trim(),
        selected: o.selected,
        disabled: o.disabled
      });
    }
    return opts;
  }
  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1");
  }
  function buildSelector(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) {
      return `${tag}#${cssEscape(el.id)}`;
    }
    const name = el.getAttribute("name");
    if (name) {
      return `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
    }
    return tag;
  }
  function pathIndexWithinScope(el, owner) {
    const root = owner ?? document;
    const tag = el.tagName.toLowerCase();
    const type = el.type;
    const same = Array.from(root.querySelectorAll(tag)).filter((n) => {
      if (!(n instanceof HTMLElement)) return false;
      if (n === el) return true;
      if (tag === "input") {
        return n.type === type;
      }
      return true;
    });
    return same.indexOf(el);
  }
  function buildFieldTarget(el, owner, label) {
    const tag = el.tagName.toLowerCase();
    const type = el instanceof HTMLInputElement ? el.type || "text" : tag;
    const id = el.getAttribute("id") ?? "";
    const name = el.getAttribute("name") ?? "";
    const ariaLabel = el.getAttribute("aria-label") ?? "";
    const placeholder = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.getAttribute("placeholder") ?? "" : "";
    const autocomplete = el.getAttribute("autocomplete") ?? "";
    const formId = owner ? owner.id ?? "" : "";
    const formName = owner ? owner.getAttribute("name") ?? "" : "";
    const radioName = type === "radio" ? name : void 0;
    const pathIndex = pathIndexWithinScope(el, owner);
    const selector = buildSelector(el);
    return {
      id,
      name,
      tag,
      type,
      formId,
      formName,
      label,
      ariaLabel,
      placeholder,
      autocomplete,
      radioName,
      pathIndex,
      selector
    };
  }
  function buildSubmitTarget(el, owner) {
    const tag = el.tagName.toLowerCase();
    const type = el instanceof HTMLInputElement ? el.type || "submit" : el.type || "submit";
    const id = el.getAttribute("id") ?? "";
    const name = el.getAttribute("name") ?? "";
    const text = (el.textContent ?? "").trim();
    const ariaLabel = el.getAttribute("aria-label") ?? "";
    const formId = owner ? owner.id ?? "" : "";
    const formName = owner ? owner.getAttribute("name") ?? "" : "";
    const pathIndex = pathIndexWithinScope(el, owner);
    const selector = buildSelector(el);
    return { id, name, tag, type, text, ariaLabel, formId, formName, pathIndex, selector };
  }
  var liveElements = /* @__PURE__ */ new Map();
  var seenRadios = /* @__PURE__ */ new WeakSet();
  function isRadioGroupable(el) {
    if (el.tagName === "INPUT" && el.type === "radio" && el.name) return true;
    if (el.getAttribute("role") === "radio") return true;
    return false;
  }
  function buildField(el, groupId, groupFieldIndex, owner) {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id") ?? "";
    const name = el.getAttribute("name") ?? "";
    const placeholder = "placeholder" in el ? el.getAttribute("placeholder") ?? "" : "";
    const ariaLabel = el.getAttribute("aria-label") ?? "";
    const type = tag === "input" ? classifyInput(el) : tag;
    const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
    const disabled = isDisabled(el);
    const readOnly = isReadOnly(el);
    const visible = isElementVisible(el);
    const autocomplete = getAutocomplete(el);
    let label = extractSemanticContext(el, id, name);
    const semanticContext = label;
    const { hint, sources } = inferSemanticHint({
      type,
      name,
      id,
      label,
      placeholder,
      ariaLabel,
      autocomplete
    });
    let semanticHint = hint;
    if (type === "select" && semanticHint === "unknown") semanticHint = "select_choice";
    if (tag === "textarea" && semanticHint === "unknown") semanticHint = "textarea";
    let options = [];
    if (el instanceof HTMLSelectElement) {
      options = extractOptions(el);
    } else if (el instanceof HTMLInputElement && el.type === "radio") {
      const radioName = el.name;
      if (radioName) {
        const root = owner ?? document;
        let escapedName = radioName;
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
          escapedName = CSS.escape(radioName);
        } else {
          escapedName = radioName.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1");
        }
        const siblings = Array.from(root.querySelectorAll(`input[type="radio"][name="${escapedName}"]`));
        for (const s of siblings) {
          seenRadios.add(s);
        }
        options = siblings.map((s) => ({
          value: s.value ?? "",
          text: (s.getAttribute("aria-label") ?? "").trim() || extractSemanticContext(s, s.id, s.name) || s.value || "",
          selected: s.checked,
          disabled: s.disabled
        }));
        let p = el.parentElement;
        while (p) {
          if (p.tagName === "FIELDSET") {
            const leg = p.querySelector(":scope > legend");
            if (leg && leg.textContent) {
              const legendText = leg.textContent.trim();
              if (legendText) {
                label = legendText;
              }
            }
            break;
          }
          p = p.parentElement;
        }
      } else {
        const v = el.value ?? "";
        options = [{
          value: v,
          text: (el.getAttribute("aria-label") ?? "").trim() || v,
          selected: el.checked,
          disabled: el.disabled
        }];
      }
    } else if (el.getAttribute("role") === "radio") {
      const name2 = el.getAttribute("name");
      const radiogroup = el.closest('[role="radiogroup"]');
      const ariaLabelledby = el.getAttribute("aria-labelledby");
      const root = owner ?? document;
      const allRadios = Array.from(root.querySelectorAll('[role="radio"]'));
      const siblings = allRadios.filter((r) => {
        if (name2 && r.getAttribute("name") === name2) return true;
        if (radiogroup && r.closest('[role="radiogroup"]') === radiogroup) return true;
        if (ariaLabelledby && r.getAttribute("aria-labelledby") === ariaLabelledby) return true;
        if (!name2 && !radiogroup && !ariaLabelledby) return r === el;
        return false;
      });
      for (const s of siblings) seenRadios.add(s);
      options = siblings.map((s, idx) => {
        const sId = s.id || `custom_radio_${idx}`;
        return {
          value: s.getAttribute("value") ?? `radio_${idx}`,
          text: extractSemanticContext(s, sId, s.getAttribute("name") ?? "") || (s.textContent || "").trim(),
          selected: s.getAttribute("aria-checked") === "true",
          disabled: s.getAttribute("aria-disabled") === "true"
        };
      });
    }
    const stableId = `${groupId}.f${groupFieldIndex}`;
    liveElements.set(stableId, new WeakRef(el));
    const valuePresent = getValuePresent(el);
    const sensitive = containsSensitiveValue(el);
    let repeatingGroup;
    if (name) {
      const m = name.match(/^([a-zA-Z0-9]+)(?:\[(\d+)\]|_(\d+)_)(?:\.|\[)?([a-zA-Z0-9_]+)\]?$/);
      if (m) {
        repeatingGroup = {
          baseName: m[1],
          index: parseInt(m[2] || m[3], 10)
        };
      }
    }
    if (!repeatingGroup) {
      let p = el.parentElement;
      while (p) {
        if (p.tagName === "FIELDSET") {
          const leg = p.querySelector(":scope > legend");
          if (leg && leg.textContent) {
            const text = leg.textContent.trim();
            const baseText = text.replace(/#?\d+$/, "").trim();
            const doc = owner ?? document;
            const allFieldsets = Array.from(doc.querySelectorAll("fieldset")).filter((fs) => {
              const l = fs.querySelector(":scope > legend");
              return l && l.textContent && l.textContent.trim().replace(/#?\d+$/, "").trim() === baseText;
            });
            if (allFieldsets.length > 1 || text !== baseText) {
              const baseName = baseText.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_m, chr) => chr.toUpperCase());
              repeatingGroup = {
                baseName,
                index: allFieldsets.indexOf(p) > -1 ? allFieldsets.indexOf(p) : 0
              };
            }
          }
          break;
        }
        p = p.parentElement;
      }
    }
    const target = buildFieldTarget(el, owner, label);
    let controlType = "input-text";
    if (tag === "input") {
      if (SUPPORTED_INPUT_TYPES.has(type)) {
        controlType = `input-${type}`;
      }
    } else if (tag === "textarea") {
      controlType = "textarea";
    } else if (tag === "select") {
      controlType = "select";
    } else if (tag === "button") {
      controlType = "button";
    } else {
      const role = el.getAttribute("role");
      if (role === "combobox") controlType = "custom-combobox";
      if (role === "radio") controlType = "custom-radio";
      if (role === "checkbox") controlType = "custom-checkbox";
    }
    return {
      stableId,
      tag,
      type,
      controlType,
      name,
      id,
      label,
      placeholder,
      ariaLabel,
      required,
      visible,
      disabled,
      readOnly,
      autocomplete,
      semanticHint,
      semanticSources: sources,
      semanticContext,
      options,
      valuePresent,
      containsSensitiveValue: sensitive,
      target,
      repeatingGroup
    };
  }
  function buildSubmitControl(el, groupId, index, owner) {
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? el.type || "submit" : el.type || "submit";
    const text = (el.textContent ?? "").trim();
    const ariaLabel = el.getAttribute("aria-label") ?? "";
    const stableId = `${groupId}.s${index}`;
    liveElements.set(stableId, new WeakRef(el));
    return {
      stableId,
      tag,
      type,
      text,
      ariaLabel,
      disabled: isDisabled(el),
      visible: isElementVisible(el),
      target: buildSubmitTarget(el, owner)
    };
  }
  function groupIdFor(kind, raw, index) {
    const base = kind === "form" ? raw instanceof HTMLFormElement ? raw.id || raw.getAttribute("name") || `form_${index}` : raw : raw;
    return `${kind}_${index}_${base.toString().replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "x"}`;
  }
  function findOwnerForm(el, forms) {
    const direct = el.form;
    if (direct) {
      if (forms.indexOf(direct) !== -1) return direct;
    }
    let p = el.parentElement;
    while (p) {
      if (p.tagName === "FORM") {
        if (forms.indexOf(p) !== -1) return p;
      }
      p = p.parentElement;
    }
    return null;
  }
  function groupLabelText(form) {
    const aria = form.getAttribute("aria-label") ?? "";
    if (aria.trim()) return aria.trim();
    const labelledBy = form.getAttribute("aria-labelledby");
    if (labelledBy) {
      const refs = labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter((n) => n !== null);
      const t = refs.map((r) => (r.textContent ?? "").trim()).join(" ");
      if (t) return t;
    }
    const legend = form.querySelector(":scope > fieldset > legend, :scope > legend");
    if (legend) return (legend.textContent ?? "").trim();
    return "";
  }
  function detectFromRealForms(forms) {
    const groups = [];
    const assigned = /* @__PURE__ */ new WeakSet();
    const groupIndexByForm = /* @__PURE__ */ new Map();
    const seenInGroupPerForm = /* @__PURE__ */ new WeakMap();
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      const groupId = groupIdFor("form", form, i);
      const fields = [];
      const submits = [];
      const seen = /* @__PURE__ */ new WeakSet();
      seenInGroupPerForm.set(form, seen);
      const descendants = Array.from(form.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="radio"], [role="checkbox"]'));
      for (const d of descendants) {
        if (!isFormElement(d)) continue;
        if (d.tagName === "INPUT" && d.type === "hidden") {
          assigned.add(d);
          continue;
        }
        if (isSubmitControl(d)) {
          if (!seen.has(d)) {
            seen.add(d);
            submits.push(buildSubmitControl(d, groupId, submits.length, form));
            assigned.add(d);
          }
          continue;
        }
        if (!isCandidateControl(d)) continue;
        if (isRadioGroupable(d)) {
          if (seenRadios.has(d)) continue;
        }
        if (seen.has(d)) continue;
        seen.add(d);
        fields.push(buildField(d, groupId, fields.length, form));
        assigned.add(d);
      }
      const metadata = {
        stableId: groupId,
        kind: "form",
        name: form.getAttribute("name") ?? "",
        action: form.getAttribute("action") ?? "",
        method: (form.getAttribute("method") ?? "get").toLowerCase(),
        autocomplete: form.getAttribute("autocomplete") ?? "",
        enctype: form.getAttribute("enctype") ?? "",
        target: form.getAttribute("target") ?? "",
        fieldCount: fields.length,
        submitCount: submits.length,
        labelText: groupLabelText(form)
      };
      groups.push({ metadata, fields, submitControls: submits });
      groupIndexByForm.set(form, i);
    }
    return { groups, assigned, groupIndexByForm };
  }
  function collectExternalControls(forms, assigned, groupIndexByForm, groups) {
    const candidates = Array.from(document.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="radio"], [role="checkbox"]'));
    for (const el of candidates) {
      if (!isFormElement(el)) continue;
      if (assigned.has(el)) continue;
      if (el.tagName === "INPUT" && el.type === "hidden") continue;
      if (!isCandidateControl(el)) continue;
      if (isRadioGroupable(el)) {
        if (seenRadios.has(el)) continue;
      }
      const owner = findOwnerForm(el, forms);
      if (!owner) continue;
      const gIdx = groupIndexByForm.get(owner);
      if (gIdx == null) continue;
      const group = groups[gIdx];
      const groupId = group.metadata.stableId;
      if (isSubmitControl(el)) {
        group.submitControls.push(buildSubmitControl(el, groupId, group.submitControls.length, owner));
      } else {
        group.fields.push(buildField(el, groupId, group.fields.length, owner));
      }
      group.metadata.fieldCount = group.fields.length;
      group.metadata.submitCount = group.submitControls.length;
      assigned.add(el);
    }
  }
  function collectLooseControls(assigned) {
    const loose = [];
    const all = Array.from(document.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="radio"], [role="checkbox"]'));
    for (const el of all) {
      if (!isFormElement(el)) continue;
      if (assigned.has(el)) continue;
      if (el.tagName === "INPUT" && el.type === "hidden") continue;
      if (!isCandidateControl(el)) continue;
      if (isRadioGroupable(el)) {
        if (seenRadios.has(el)) continue;
      }
      loose.push(el);
    }
    return loose;
  }
  function buildLogicalGroup(loose, index) {
    const groupId = groupIdFor("logical", `loose_${index}`, index);
    const fields = [];
    const submits = [];
    const sorted = loose.slice().sort((a, b) => {
      if (a === b) return 0;
      const cmp = a.compareDocumentPosition(b);
      if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    for (const el of sorted) {
      if (isSubmitControl(el)) {
        submits.push(buildSubmitControl(el, groupId, submits.length, null));
      } else {
        fields.push(buildField(el, groupId, fields.length, null));
      }
    }
    const metadata = {
      stableId: groupId,
      kind: loose.length === 0 ? "orphan" : "logical",
      name: "",
      action: "",
      method: "",
      autocomplete: "",
      enctype: "",
      target: "",
      fieldCount: fields.length,
      submitCount: submits.length,
      labelText: ""
    };
    return { metadata, fields, submitControls: submits };
  }
  function detectPage() {
    liveElements.clear();
    seenRadios = /* @__PURE__ */ new WeakSet();
    const forms = Array.from(document.querySelectorAll("form"));
    const { groups, assigned, groupIndexByForm } = detectFromRealForms(forms);
    collectExternalControls(forms, assigned, groupIndexByForm, groups);
    const loose = collectLooseControls(assigned);
    if (loose.length > 0) {
      groups.push(buildLogicalGroup(loose, groups.length));
    }
    let totalFields = 0;
    for (const g of groups) totalFields += g.fields.length;
    return {
      url: location.href,
      title: document.title,
      detectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      formCount: groups.length,
      totalFieldCount: totalFields,
      forms: groups
    };
  }
  function getVisualContext(stableId) {
    const ref = liveElements.get(stableId);
    const el = ref?.deref();
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const winHeight = window.innerHeight;
    const winWidth = window.innerWidth;
    let visibility = "visible";
    if (!isElementVisible(el)) {
      visibility = "hidden";
    } else if (rect.bottom <= 0 || rect.top >= winHeight || rect.right <= 0 || rect.left >= winWidth) {
      visibility = "outside-viewport";
    } else if (rect.top < 0 || rect.bottom > winHeight || rect.left < 0 || rect.right > winWidth) {
      visibility = "partially-visible";
    }
    const boundingBox = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
    const texts = [];
    if (el.previousElementSibling && isElementVisible(el.previousElementSibling)) {
      const t = (el.previousElementSibling.textContent ?? "").trim();
      if (t) texts.push(t);
    }
    let p = el.parentElement;
    let steps = 0;
    while (p && steps < 2) {
      if (isElementVisible(p)) {
        let visibleText = "";
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (parent && !isElementVisible(parent)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent && ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let currentNode = walker.nextNode();
        while (currentNode) {
          visibleText += currentNode.nodeValue + " ";
          currentNode = walker.nextNode();
        }
        const t = visibleText.trim();
        if (t) texts.push(t);
      }
      p = p.parentElement;
      steps++;
    }
    const cleanTexts = [];
    for (const t of texts) {
      let normalized = t.replace(/\s+/g, " ");
      if (normalized.length < 2) continue;
      if (normalized.length > 300) {
        normalized = normalized.substring(0, 300);
      }
      const isSubset = cleanTexts.some((existing) => existing.includes(normalized));
      if (isSubset) continue;
      for (let i = cleanTexts.length - 1; i >= 0; i--) {
        if (normalized.includes(cleanTexts[i])) {
          cleanTexts.splice(i, 1);
        }
      }
      cleanTexts.push(normalized);
    }
    let nearbyText = cleanTexts.join(" | ");
    if (nearbyText.length > 200) {
      nearbyText = nearbyText.substring(0, 200) + "...";
    }
    return {
      boundingBox,
      visibility,
      nearbyText: nearbyText || void 0
    };
  }

  // tests/smoke-browser-entry.ts
  window.detectPage = detectPage;
  window.getVisualContext = getVisualContext;
})();
