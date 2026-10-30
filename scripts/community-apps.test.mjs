import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDatabase,
  asUser,
  asService,
  asRole,
  makeUser,
  query,
} from "./pglite-harness.mjs";

describe("Community Apps & Custom App System Database Tests", async () => {
  const db = await createDatabase();

  const devId = await makeUser(db, { username: "developer_alice", role: "user" });
  const modId = await makeUser(db, { username: "moderator_bob", role: "moderator" });
  const userCharlieId = await makeUser(db, { username: "user_charlie", role: "user" });

  let publicAppId = null;
  let unlistedAppId = null;

  it("1. Normal user can submit an application with status = pending", async () => {
    const res = await asUser(db, devId, async () => {
      const rows = await query(
        db,
        `select public.community_app_submit(
          'Retro Calc',
          'A simple scientific calculator app',
          'https://retrocalc.example.com',
          'https://retrocalc.example.com/icon.png',
          'productivity',
          'public',
          'Note for reviewer'
        ) as app`,
      );
      return rows[0].app;
    });

    assert.equal(res.name, "Retro Calc");
    assert.equal(res.verification_status, "pending");
    assert.equal(res.visibility, "public");
    assert.equal(res.developer_id, devId);
    publicAppId = res.id;
  });

  it("2. Submitting non-HTTPS or unsafe schemes is rejected", async () => {
    await asUser(db, devId, async () => {
      await assert.rejects(
        () =>
          query(
            db,
            `select public.community_app_submit('Insecure', 'A description with enough length', 'http://insecure.test')`,
          ),
        /HTTPS_URL_REQUIRED/,
      );
      await assert.rejects(
        () =>
          query(
            db,
            `select public.community_app_submit('XSS', 'A description with enough length', 'javascript:alert(1)')`,
          ),
        /HTTPS_URL_REQUIRED/,
      );
    });
  });

  it("3. Developer CANNOT approve their own application", async () => {
    await asUser(db, devId, async () => {
      await assert.rejects(
        () =>
          query(
            db,
            `select public.community_app_decide($1, 'approve', 'Self approval attempt')`,
            [publicAppId],
          ),
        /NOT_AUTHORIZED_AS_MODERATOR|CANNOT_APPROVE_OWN_APP/,
      );
    });
  });

  it("4. Ordinary user CANNOT approve applications", async () => {
    await asUser(db, userCharlieId, async () => {
      await assert.rejects(
        () =>
          query(
            db,
            `select public.community_app_decide($1, 'approve', 'Hacker approval')`,
            [publicAppId],
          ),
        /NOT_AUTHORIZED_AS_MODERATOR/,
      );
    });
  });

  it("5. Ordinary user CANNOT install a pending application", async () => {
    await asUser(db, userCharlieId, async () => {
      await assert.rejects(
        () =>
          query(db, `select public.community_app_install($1)`, [publicAppId]),
        /APP_NOT_VERIFIED_FOR_INSTALLATION/,
      );
    });
  });

  it("6. Moderator claims and approves application with audit logging", async () => {
    // Claim review
    await asUser(db, modId, async () => {
      const claimRes = await query(
        db,
        `select public.community_app_decide($1, 'claim') as app`,
        [publicAppId],
      );
      assert.equal(claimRes[0].app.verification_status, "under_review");

      // Approve
      const approveRes = await query(
        db,
        `select public.community_app_decide($1, 'approve', 'Looks safe and clean') as app`,
        [publicAppId],
      );
      assert.equal(approveRes[0].app.verification_status, "verified");
      assert.equal(approveRes[0].app.verified_by, modId);
    });

    // Verify audit logs were written
    const logs = await asUser(db, modId, async () => {
      return await query(
        db,
        `select action, new_status, reason from public.app_moderation_logs where app_id = $1 order by id asc`,
        [publicAppId],
      );
    });
    assert.equal(logs.length, 2);
    assert.equal(logs[0].action, "claim");
    assert.equal(logs[1].action, "approve");
  });

  it("7. User can now install the verified application", async () => {
    const installRes = await asUser(db, userCharlieId, async () => {
      const rows = await query(
        db,
        `select public.community_app_install($1) as result`,
        [publicAppId],
      );
      return rows[0].result;
    });
    assert.equal(installRes.ok, true);

    // Verify installation record
    const installs = await asUser(db, userCharlieId, async () => {
      return await query(
        db,
        `select * from public.app_installations where user_id = $1 and app_id = $2`,
        [userCharlieId, publicAppId],
      );
    });
    assert.equal(installs.length, 1);
  });

  it("8. Reverification: If developer changes URL, app status automatically reverts to pending", async () => {
    await asUser(db, devId, async () => {
      await query(
        db,
        `update public.custom_apps set website_url = 'https://new-retrocalc.example.com' where id = $1`,
        [publicAppId],
      );
    });

    // Check status
    const appRows = await asUser(db, devId, async () => {
      return await query(
        db,
        `select verification_status, verified_by from public.custom_apps where id = $1`,
        [publicAppId],
      );
    });
    assert.equal(appRows[0].verification_status, "pending");
    assert.equal(appRows[0].verified_by, null);

    // Now another user tries to install it -> blocked!
    await asUser(db, devId, async () => {
      await assert.rejects(
        () => query(db, `select public.community_app_install($1)`, [publicAppId]),
        /APP_NOT_VERIFIED_FOR_INSTALLATION/,
      );
    });

    // Moderator re-approves it
    await asUser(db, modId, async () => {
      await query(db, `select public.community_app_decide($1, 'approve', 'Re-verified')`, [
        publicAppId,
      ]);
    });
  });

  it("9. Unlisted application: submit, verify, direct resolve, installation checks", async () => {
    // Dev submits unlisted app
    const unlisted = await asUser(db, devId, async () => {
      const rows = await query(
        db,
        `select public.community_app_submit(
          'Secret Tool',
          'Private unlisted utility',
          'https://secret.example.com',
          null,
          'utilities',
          'unlisted'
        ) as app`,
      );
      return rows[0].app;
    });
    unlistedAppId = unlisted.id;
    const shareToken = unlisted.share_token;
    assert.ok(shareToken);

    // Not visible in public directory
    const publicList = await asUser(db, userCharlieId, async () => {
      return await query(
        db,
        `select * from public.custom_apps where visibility = 'public' and verification_status = 'verified'`,
      );
    });
    assert.ok(!publicList.some((a) => a.id === unlistedAppId));

    // Direct resolve before verification shows pending status
    const resolveBefore = await asUser(db, userCharlieId, async () => {
      const rows = await query(
        db,
        `select public.community_app_resolve($1) as app`,
        [shareToken],
      );
      return rows[0].app;
    });
    assert.equal(resolveBefore.verification_status, "pending");

    // Charlie cannot install unverified unlisted app
    await asUser(db, userCharlieId, async () => {
      await assert.rejects(
        () => query(db, `select public.community_app_install($1)`, [unlistedAppId]),
        /APP_NOT_VERIFIED_FOR_INSTALLATION/,
      );
    });

    // Moderator approves unlisted app
    await asUser(db, modId, async () => {
      await query(db, `select public.community_app_decide($1, 'approve', 'Unlisted tool approved')`, [
        unlistedAppId,
      ]);
    });

    // Charlie can now install it
    const installRes = await asUser(db, userCharlieId, async () => {
      const rows = await query(
        db,
        `select public.community_app_install($1) as res`,
        [unlistedAppId],
      );
      return rows[0].res;
    });
    assert.equal(installRes.ok, true);

    // Unlisted STILL does not appear in public gallery search
    const publicAfter = await asUser(db, userCharlieId, async () => {
      return await query(
        db,
        `select * from public.custom_apps where visibility = 'public' and verification_status = 'verified'`,
      );
    });
    assert.ok(!publicAfter.some((a) => a.id === unlistedAppId));
  });

  it("10. Reporting: user can report, duplicate is prevented, moderator reviews", async () => {
    // Charlie reports publicAppId
    await asUser(db, userCharlieId, async () => {
      await query(
        db,
        `insert into public.app_reports (app_id, reporter_id, category, description)
         values ($1, $2, 'broken', 'Buttons do not click')`,
        [publicAppId, userCharlieId],
      );
    });

    // Duplicate report while pending is prevented
    await asUser(db, userCharlieId, async () => {
      await assert.rejects(
        () =>
          query(
            db,
            `insert into public.app_reports (app_id, reporter_id, category, description)
             values ($1, $2, 'broken', 'Spam report')`,
            [publicAppId, userCharlieId],
          ),
        /app_reports_unique_pending/,
      );
    });

    // Dev cannot see reports submitted by Charlie (RLS check)
    const devReports = await asUser(db, devId, async () => {
      return await query(db, `select * from public.app_reports`);
    });
    assert.equal(devReports.length, 0);

    // Moderator can view reports
    const modReports = await asUser(db, modId, async () => {
      return await query(db, `select * from public.app_reports where app_id = $1`, [
        publicAppId,
      ]);
    });
    assert.equal(modReports.length, 1);
  });

  it("11. Suspended application cannot be installed and uninstalls cleanly", async () => {
    // Moderator suspends publicAppId
    await asUser(db, modId, async () => {
      await query(
        db,
        `select public.community_app_decide($1, 'suspend', 'Security vulnerability reported')`,
        [publicAppId],
      );
    });

    // Check status is suspended
    const appRows = await asUser(db, devId, async () => {
      return await query(
        db,
        `select verification_status, suspension_reason from public.custom_apps where id = $1`,
        [publicAppId],
      );
    });
    assert.equal(appRows[0].verification_status, "suspended");
    assert.equal(appRows[0].suspension_reason, "Security vulnerability reported");

    // Attempting new installation fails
    const devUser = await makeUser(db, { username: "user_david", role: "user" });
    await asUser(db, devUser, async () => {
      await assert.rejects(
        () => query(db, `select public.community_app_install($1)`, [publicAppId]),
        /APP_NOT_VERIFIED_FOR_INSTALLATION/,
      );
    });

    // Charlie uninstalls it
    await asUser(db, userCharlieId, async () => {
      const res = await query(
        db,
        `select public.community_app_uninstall($1) as res`,
        [publicAppId],
      );
      assert.equal(res[0].res.ok, true);
    });

    const chInstalls = await asUser(db, userCharlieId, async () => {
      return await query(
        db,
        `select * from public.app_installations where user_id = $1 and app_id = $2`,
        [userCharlieId, publicAppId],
      );
    });
    assert.equal(chInstalls.length, 0);
  });
});
