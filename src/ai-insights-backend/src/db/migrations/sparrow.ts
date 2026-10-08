import { Pool } from "pg";

// Insert initial routing concepts once; preserve operator edits on later starts.
export async function migrateSparrow(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sparrow-intents-migration'))");
    await client.query(`CREATE TABLE IF NOT EXISTS sparrow_intents (
      code VARCHAR(80) PRIMARY KEY, description TEXT NOT NULL,
      allows_inference BOOLEAN NOT NULL DEFAULT FALSE,
      conversational BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`INSERT INTO sparrow_intents (code, description, allows_inference, conversational) VALUES
      ('PREDICT', 'Forecast a future metric using an available trained model.', TRUE, FALSE),
      ('ANALYZE', 'Explore project data and calculate relevant business metrics.', FALSE, FALSE),
      ('EXPLAIN', 'Explain observed results using data; distinguish association from causality.', FALSE, FALSE),
      ('DIAGNOSE', 'Investigate changes, anomalies and potential business drivers.', FALSE, FALSE),
      ('COMPARE', 'Compare periods, segments or explicitly requested model performance.', FALSE, FALSE),
      ('RECOMMEND', 'Propose actions grounded in business data and state uncertainty.', FALSE, FALSE),
      ('WHAT_IF', 'Assess a scenario only when available tools support the requested changes.', TRUE, FALSE),
      ('SUMMARIZE', 'Summarize actual project status or business performance.', FALSE, FALSE),
      ('MODEL_INFERENCE', 'Execute explicitly requested trained-model predictions.', TRUE, FALSE),
      ('MODEL_EXPLANATION', 'Explain available model metadata and evaluation results.', FALSE, FALSE),
      ('DATA_QUESTION', 'Answer a factual question about available data.', FALSE, FALSE),
      ('GENERAL_CONVERSATION', 'Greetings and capability questions; answer the whole message.', FALSE, TRUE),
      ('IRRELEVANT', 'Request beyond available capabilities; explain the limitation.', FALSE, TRUE)
      ON CONFLICT (code) DO NOTHING`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
