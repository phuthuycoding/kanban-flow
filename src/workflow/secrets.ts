interface SecretPattern {
  /** Group 1 captures the credential value that the placeholder check is applied to. */
  re: RegExp;
  /** High-confidence formats are never excused by placeholder words; only a masked value (xxxx/****) is. */
  high: boolean;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { re: /\bAuthorization\s*:\s*Bearer\s+([A-Za-z0-9._~+/=-]{12,})/i, high: false },
  { re: /\bCookie\s*:\s*([^;\n]{12,})/i, high: false },
  { re: /\b(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?([^\s"']{8,})/i, high: false },
  { re: /\b((?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,})/, high: true },
  { re: /\b(sk-[A-Za-z0-9]{20,})/, high: true },
  { re: /\b(AKIA[0-9A-Z]{16})\b/, high: true },
  { re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})/, high: true },
  { re: /(-----BEGIN [A-Z ]*PRIVATE KEY-----)/, high: true },
  // A JWT needs all three base64url segments. `eyJ` alone is just base64 for `{"`, which any
  // encoded JSON blob starts with, so matching the prefix on its own would fire on harmless data.
  { re: /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/, high: true },
  { re: /\b(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+_-]{20,})/, high: true },
  { re: /\b(https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]{20,})/, high: true },
  // Group 1 is the password, not the whole URL, so the placeholder exemption and the masking
  // done on output both land on the part that actually matters. A URL with no password is not a
  // secret: `postgres://localhost/db` has nothing to leak.
  //
  // This one is NOT high-confidence, unlike the three above. Those match a prefix that only a
  // real credential carries — `ghp_`, `eyJ…`, the Slack host — so no wording on the line should
  // excuse them. A connection string has no such marker: it is pure URL shape, which a perfectly
  // honest template like `scheme://user:<password>@host` also has. Marking it high made the
  // scanner reject documentation for describing the very format it was taught to find.
  { re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:([^\s:@/]{3,})@/, high: false },
];

const PLACEHOLDERISH = /\{[^}\n]{0,60}\}|<[a-z0-9_ -]+>|\*{3,}|x{4,}|\b(?:redacted|masked|example|changeme|placeholder|dummy|sample)\b|\byour[_-]/i;
const MASKED_VALUE = /^[A-Za-z_-]*?[xX*]{4,}$/;

function isPlaceholderValue(value: string, high: boolean): boolean {
  return high ? MASKED_VALUE.test(value) : PLACEHOLDERISH.test(value);
}

/**
 * Return lines that look like real secrets. The placeholder exemption is applied
 * to the captured value only, so a comment such as "# example" on the same line
 * cannot excuse a real credential. Hits are masked: only the first characters of
 * the value are kept so callers can log them safely.
 */
export function findSecretLike(content: string): string[] {
  const hits: string[] = [];
  for (const line of content.split("\n")) {
    for (const { re, high } of SECRET_PATTERNS) {
      const match = re.exec(line);
      if (!match) continue;
      const value = match[1];
      if (isPlaceholderValue(value, high)) continue;
      hits.push(line.trim().replace(value, `${value.slice(0, 4)}…`).slice(0, 80));
      break;
    }
  }
  return hits;
}
