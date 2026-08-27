/**
 * JSON profile contract.
 *
 * A profile is the source of truth that the form-filling agent will use
 * to answer form fields. The shape is intentionally permissive — the
 * AI/semantic layer (added in a later task) is what decides which
 * profile key answers which field.
 *
 * Values may be:
 *   - string    — for text inputs, textareas, dates, times
 *   - boolean   — for checkboxes (true = check, false = uncheck)
 *   - string[]  — for multi-select or checkbox groups
 *   - { label, value }   — for select / radio options
 *
 * This file is types only — no runtime, no chrome.storage, no DOM.
 */

export type ProfileValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | { label: string; value: string };

export type JsonProfile = Record<string, ProfileValue>;

export interface ProfileEntry {
  id: string;
  name: string;
  profile: JsonProfile;
  updatedAt: string;
}

export interface ProfileListEntry {
  id: string;
  name: string;
  updatedAt: string;
}
