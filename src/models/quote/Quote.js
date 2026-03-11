const mongoose = require("mongoose");
const { QUOTE_BOOKING_TYPE, QUOTE_STATUS } = require("../../config/constants");

const InclusionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    maxQuantity: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const AddonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const TotalsSchema = new mongoose.Schema(
  {
    venueBase: { type: Number, required: true, min: 0 },
    venueGst: { type: Number, required: true, min: 0 },
    addonTotal: { type: Number, required: true, min: 0 },
    addonGst: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const PricingSchema = new mongoose.Schema(
  {
    basePrice: { type: Number, required: true, min: 0 },
    inclusions: { type: [InclusionSchema], default: () => [] },
    addons: { type: [AddonSchema], default: () => [] },
    gstRate: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0 },
    totals: { type: TotalsSchema, required: true },
  },
  { _id: false }
);

const EventWindowSchema = new mongoose.Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    durationHours: { type: Number, required: true, enum: [12, 24, 36, 48] },
  },
  { _id: false }
);

const QuoteSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    bookingType: {
      type: String,
      required: true,
      enum: Object.values(QUOTE_BOOKING_TYPE),
      index: true,
    },
    spaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Space", default: null, index: true },
    eventWindow: { type: EventWindowSchema, required: true },
    pricing: { type: PricingSchema, required: true },
    draft: { type: Boolean, default: true, index: true },
    confirmed: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: Object.values(QUOTE_STATUS),
      default: QUOTE_STATUS.DRAFT,
      index: true,
    },
  },
  { timestamps: true }
);

QuoteSchema.pre("validate", function (next) {
  if (this.bookingType === QUOTE_BOOKING_TYPE.SPACE_BUYOUT && !this.spaceId) {
    return next(new Error("spaceId is required when bookingType is space_buyout"));
  }

  if (this.bookingType === QUOTE_BOOKING_TYPE.VENUE_BUYOUT) {
    this.spaceId = null;
  }

  if (this.eventWindow?.startAt && this.eventWindow?.endAt) {
    if (new Date(this.eventWindow.endAt).getTime() <= new Date(this.eventWindow.startAt).getTime()) {
      return next(new Error("eventWindow.endAt must be after eventWindow.startAt"));
    }
  }

  if (this.draft && this.confirmed) {
    return next(new Error("draft and confirmed cannot both be true"));
  }
  next();
});

QuoteSchema.index({ leadId: 1, createdAt: -1 });
QuoteSchema.index({ venueId: 1, createdAt: -1 });
QuoteSchema.index({ createdBy: 1, createdAt: -1 });
QuoteSchema.index({ draft: 1, confirmed: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Quote", QuoteSchema);
