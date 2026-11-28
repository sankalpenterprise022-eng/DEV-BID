// @/models/PushSubscription.ts
// One Web Push subscription per browser/device (endpoint is unique). A user can
// have several (phone + laptop). Removed automatically when the push service
// answers 404/410 (subscription expired / app uninstalled) or on logout.
import { Schema, model, models } from "mongoose";

const PushSubscriptionSchema = new Schema(
  {
    username: { type: String, required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: "" },
    lastOkAt: Date,
  },
  { timestamps: true, collection: "push_subscriptions" }
);

export default models.PushSubscription || model("PushSubscription", PushSubscriptionSchema);
