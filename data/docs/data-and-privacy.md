---
title: Data and privacy
published: true
---
The database runs in Frankfurt, in the EU.

Model API keys and agent auth headers are encrypted before storage using AES-256-GCM, with the ciphertext bound to the workspace it belongs to. They are decrypted only on the server, are never sent to a browser, never written to a log, and never appear in a report.

A workspace can be erased completely. Erasure removes the agents, policies, runs, verdicts, probe receipts, diagnoses and reports, and leaves behind only a record that an erasure happened and what it removed — which contains no personal data.

Erasure is all or nothing by design. Individual verdicts, policy versions and reports cannot be deleted, because a product whose evidence could be selectively removed would not be evidence.
