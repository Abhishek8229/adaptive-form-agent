export function normalizeDate(s: string): string | null {
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dmMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmMatch) {
    const p1 = parseInt(dmMatch[1], 10);
    const p2 = parseInt(dmMatch[2], 10);
    const y = parseInt(dmMatch[3], 10);
    
    let d = 0, m = 0;
    if (p1 > 12 && p2 <= 12) {
      d = p1; m = p2;
    } else if (p2 > 12 && p1 <= 12) {
      m = p1; d = p2;
    } else if (p1 === p2 && p1 <= 12) {
      d = p1; m = p2;
    } else {
      return null; 
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const ymdMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10);
    const d = parseInt(ymdMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  if (/[A-Za-z]+/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const day = d.getDate();
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

export function normalizeTime(s: string): string | null {
  s = s.trim().toLowerCase();
  
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(s)) return s;
  
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const isPM = m[4] === 'pm';
    
    if (h < 1 || h > 12) return null;
    if (min < 0 || min > 59) return null;
    
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  
  return null;
}

export function normalizeNumber(s: string): string | null {
  s = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;

  const stripped = s.replace(/^[A-Za-z$\s€£¥₹]+/, '').replace(/[\s,]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(stripped)) {
    return stripped;
  }
  return null;
}

export function normalizeTelephone(s: string): string | null {
  s = s.trim();
  const hasPlus = s.startsWith('+');
  const stripped = s.replace(/[^0-9]/g, '');
  if (!stripped) return null;
  if (stripped.length < 5 || stripped.length > 20) return null;
  return (hasPlus ? '+' : '') + stripped;
}

export function normalizeUrl(s: string): string | null {
  s = s.trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/.test(s)) return 'https://' + s;
  return null;
}

export function normalizeDateTimeLocal(s: string): string | null {
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s)) return s;
  if (/[a-zA-Z]/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    }
  }
  const spaceMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s+(([01]?\d|2[0-3]):[0-5]\d)$/);
  if (spaceMatch) {
    const time = spaceMatch[2].length === 4 ? "0" + spaceMatch[2] : spaceMatch[2];
    return `${spaceMatch[1]}T${time}`;
  }
  return null;
}
