/**
 * Sentiment — central module for Projectoolbox sentiment analysis.
 *
 * Pipeline:
 *  1. Raw text (approval comment, email, chat, meeting) → analyzer.ts
 *  2. Result stored on source record (Approval.sentiment, etc.)
 *  3. SentimentHistory row created for trend tracking
 *  4. Stakeholder.sentiment refreshed from their recent activity
 *  5. Automation rules fired if sentiment dropped
 */

export * from "./analyzer";
export * from "./recorder";
export * from "./stakeholder-updater";
export * from "./trend";
