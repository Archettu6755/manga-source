export function atob(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const input = value.replace(/\s/g, "").replace(/=+$/, "");
  if (input.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(input)) throw new Error("Invalid base64 input");
  let accumulator = 0, bits = 0, result = "";
  for (const character of input) {
    accumulator = (accumulator << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) { bits -= 8; result += String.fromCharCode((accumulator >> bits) & 255); }
  }
  return result;
}
