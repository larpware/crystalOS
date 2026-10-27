/* ==========================================================================
   Store submissions

   Community members propose applications for the Crystal Store; the proposal
   is a web application (a URL plus its metadata). Nothing runs on the server:
   an approved submission is a link the Browser opens, so review is a real
   moderation gate over what the catalogue offers, not a code-execution
   surface.
   ========================================================================== */

const STATUSES = ["pending", "approved", "rejected"];

function submissionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    url: row.url,
    status: row.status,
    reviewNote: row.review_note ?? null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? null,
    submitter: {
      id: row.submitter_id,
      username: row.submitter_username ?? null,
      displayName: row.submitter_name ?? null,
    },
  };
}

export function createAppStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_submissions (
      id TEXT PRIMARY KEY,
      submitter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT,
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      reviewed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_store_submissions_status
      ON store_submissions(status, created_at);
  `);

  const insert = db.prepare(`
    INSERT INTO store_submissions (id, submitter_id, name, description, category, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const byId = db.prepare(`
    SELECT s.*, u.username AS submitter_username, u.display_name AS submitter_name
      FROM store_submissions s LEFT JOIN users u ON u.id = s.submitter_id
     WHERE s.id = ?
  `);
  const mineStmt = db.prepare(`
    SELECT s.*, u.username AS submitter_username, u.display_name AS submitter_name
      FROM store_submissions s LEFT JOIN users u ON u.id = s.submitter_id
     WHERE s.submitter_id = ? ORDER BY s.created_at DESC LIMIT 100
  `);
  const approvedStmt = db.prepare(`
    SELECT s.*, u.username AS submitter_username, u.display_name AS submitter_name
      FROM store_submissions s LEFT JOIN users u ON u.id = s.submitter_id
     WHERE s.status = 'approved' ORDER BY s.reviewed_at DESC LIMIT 200
  `);
  const byStatusStmt = db.prepare(`
    SELECT s.*, u.username AS submitter_username, u.display_name AS submitter_name
      FROM store_submissions s LEFT JOIN users u ON u.id = s.submitter_id
     WHERE s.status = ? ORDER BY s.created_at DESC LIMIT 200
  `);
  const reviewStmt = db.prepare(`
    UPDATE store_submissions
       SET status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ?
     WHERE id = ?
  `);
  const countPending = db.prepare(
    "SELECT COUNT(*) AS n FROM store_submissions WHERE status = 'pending'",
  );

  return {
    /** A pending submission from a signed-in member. */
    submit(submitterId, input) {
      const id = `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      insert.run(
        id,
        submitterId,
        input.name,
        input.description,
        input.category,
        input.url,
        Date.now(),
      );
      return submissionRow(byId.get(id));
    },

    mine(submitterId) {
      return mineStmt.all(submitterId).map(submissionRow);
    },

    approved() {
      return approvedStmt.all().map(submissionRow);
    },

    /** Admin queue, newest first. */
    listByStatus(status) {
      const wanted = STATUSES.includes(status) ? status : "pending";
      return byStatusStmt.all(wanted).map(submissionRow);
    },

    pendingCount() {
      return countPending.get().n;
    },

    /**
     * Approve or reject. Only rows still pending can be reviewed the first
     * time; an admin may later overturn a decision (a re-review), which is
     * recorded in the same fields.
     */
    review(submissionId, adminId, action, note) {
      const row = byId.get(submissionId);
      if (!row) return { error: "That submission is gone." };
      const status = action === "approve" ? "approved" : "rejected";
      reviewStmt.run(status, note ?? null, Date.now(), adminId, submissionId);
      return { value: submissionRow(byId.get(submissionId)) };
    },

    get(submissionId) {
      return submissionRow(byId.get(submissionId));
    },
  };
}
