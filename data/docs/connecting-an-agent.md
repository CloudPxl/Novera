---
title: Connecting an agent
published: true
---
Novera talks to your agent over HTTP. You give it the endpoint URL, a JSON request body template containing `{{input}}` where the scenario text should go, and the path to the reply text in the response.

If your agent also receives data *about* a conversation — account fields, a profile, a CRM note — put `{{context}}` in the template where that data belongs. Some scenarios attack that channel, because real prompt injections arrive there rather than in something a customer typed. If there is nowhere to put it, those scenarios are reported as not run rather than sent to your agent as an ordinary message, which would be a different test.

You can also give Novera a read-only endpoint in your own systems. A scenario that expects something to change then says what must be true there, and Novera checks it independently of what your agent claims. It is GET-only by construction, a scenario cannot point it anywhere but the host you configured, the credential is separate from your agent's, and the response body is never stored.

If your endpoint needs an auth header, you name the header and paste the value. The value is encrypted before storage and only ever decrypted on the server.

Before any suite run, Novera sends one harmless request and saves the reply as a receipt. Read that receipt before trusting a full run: it is how you confirm you are testing the thing you think you are testing.

You must own the agent you connect, or be authorised to test it. That confirmation is recorded and copied onto every run, so a report can always say on whose authority the test was performed.
