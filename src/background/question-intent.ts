export function inferQuestionIntent(context: string): string | null {
  if (!context) return null;
  const lower = context.toLowerCase();

  if (/\byears\b.*\bexperience\b/i.test(lower)) return 'yearsOfExperience';
  if (/\bcurrent\b.*\btitle\b/i.test(lower)) return 'currentJobTitle';
  if (/\bjob\b.*\btitle\b/i.test(lower)) return 'jobTitle';
  if (/\bcurrent\b.*\b(employer|company)\b/i.test(lower)) return 'currentCompany';
  if (/\bcompany\b/i.test(lower)) return 'company';
  if (/\b(education|degree)\b/i.test(lower)) return 'degree';
  if (/\b(school|university|college)\b/i.test(lower)) return 'school';
  if (/\b(field of study|major)\b/i.test(lower)) return 'fieldOfStudy';
  if (/\b(legally authorized|work authorization)\b/i.test(lower)) return 'workAuthorization';
  if (/\b(require sponsorship|visa sponsorship)\b/i.test(lower)) return 'visaSponsorship';
  if (/\b(willing to relocate|relocate.*yes.*no)\b/i.test(lower)) return 'willingToRelocate';
  if (/\bremote\b.*\b(preference|work)\b/i.test(lower)) return 'remoteWorkPreference';
  if (/\b(salary|compensation|expected pay)\b/i.test(lower)) return 'expectedSalary';
  if (/\bphone\b/i.test(lower)) return 'phone';
  if (/\bemail\b/i.test(lower)) return 'email';
  if (/\bfirst\s*name\b/i.test(lower)) return 'firstName';
  if (/\blast\s*name\b/i.test(lower)) return 'lastName';
  if (/\bsurname\b/i.test(lower)) return 'lastName';
  if (/\b(date of birth|birth date|dob)\b/i.test(lower)) return 'dateOfBirth';
  if (/\bcity\b/i.test(lower)) return 'city';
  if (/\b(state|province)\b/i.test(lower)) return 'state';
  if (/\bcountry\b/i.test(lower)) return 'country';
  if (/\b(postal|zip)\b/i.test(lower)) return 'postalCode';
  if (/\blinkedin\b/i.test(lower)) return 'linkedIn';
  if (/\bgithub\b/i.test(lower)) return 'github';
  if (/\b(website|portfolio)\b/i.test(lower)) return 'website';

  return null;
}
