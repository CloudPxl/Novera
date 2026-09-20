---
title: Connecting an agent
published: true
---
Novera talks to your agent over HTTP. You give it the endpoint URL, a JSON request body template containing `{{input}}` where the scenario text should go, and the path to the reply text in the response.

If your endpoint needs an auth header, you name the header and paste the value. The value is encrypted before storage and only ever decrypted on the server.

Before any suite run, Novera sends one harmless request and saves the reply as a receipt. Read that receipt before trusting a full run: it is how you confirm you are testing the thing you think you are testing.

You must own the agent you connect, or be authorised to test it. That confirmation is recorded and copied onto every run, so a report can always say on whose authority the test was performed.
