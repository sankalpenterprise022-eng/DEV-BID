// Generates a VAPID key pair for Web Push:   npm run gen:vapid
// Copy the printed lines into .env.local (and Vercel env). Generate ONCE:
// new keys invalidate every saved browser subscription (users must re-enable notifications).
import { generateVAPIDKeys } from "web-push";

const { publicKey, privateKey } = generateVAPIDKeys();
console.log("# Web Push (VAPID) - paste into .env.local");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
