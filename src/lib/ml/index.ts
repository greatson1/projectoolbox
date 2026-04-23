/**
 * ML Insights — Central module for Projectoolbox's learned predictions.
 *
 * Architecture: Instead of heavyweight ML frameworks (impractical on Vercel
 * serverless), we use statistical methods that work per-org and train nightly:
 *   1. Approval Likelihood — Bayesian rate by (action type × impact tier × approver)
 *   2. Impact Calibration — Rolling mean of user-edited impact scores per action type
 *   3. Story Point Calibration — Team velocity multiplier from estimated vs actual hours
 *   4. Risk Materialisation — Frequency-based classifier: P(risk→issue | category, severity)
 *   5. Similar Projects — Cosine similarity on OpenAI embeddings of project descriptions
 *
 * Every model is pure JS; training runs as a nightly cron. Predictions cached in MLInsight.
 */

export * from "./approval-likelihood";
export * from "./impact-calibration";
export * from "./story-point-calibration";
export * from "./risk-materialisation";
export * from "./similar-projects";
export * from "./trainer";
