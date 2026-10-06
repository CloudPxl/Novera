---
title: Signing in and your account
published: true
---
You sign in to Novera with an email address and a password, or — where they are switched on — with a Google or GitHub account. Every method opens the same account: the same workspaces, agents, reports and API keys.

## Creating an account with email

Choose **Create one** on the sign-in page, enter your address and a password of at least 8 characters, and Novera asks its email provider to send you a confirmation link. The page then shows **Check your inbox** with the address the link was sent to.

Novera does not say the email has arrived — only that it was handed over for delivery. If the email could not be sent at all, the page says so and **no account is created**; nothing was saved, so you can try again later or use another way in.

If an account already exists for that address, no new email is sent and the page reads the same way. This is deliberate: the sign-up form does not tell a stranger whether an address has an account.

## The confirmation email did not arrive

- Wait a few minutes, and look in spam or promotions.
- Press **Send a new link**. A new link replaces the old one; links in earlier emails stop working.
- Typed the wrong address? Press **Use a different one** and sign up again with the right one.
- Still nothing after ten minutes? Continue with Google or GitHub if they are offered, or write to us from the support page — a person reads it.

Opening the link in the same browser signs you straight in. Opening it on another device confirms your address, and you then sign in by hand.

If you try to sign in before confirming, the page says the address is not confirmed yet and offers a new link in place.

## Forgotten your password

Choose **Forgotten your password?**, enter your address, and use the link in the email. It signs you in once and asks for a new password; it expires, and using it ends any other session. The answer is the same whether or not the address has an account — unless the email could not be sent, in which case the page says it was not sent.

## Google and GitHub

**Continue with Google** or **Continue with GitHub** appears only once that provider is switched on for Novera. The provider tells Novera your verified email address; if it does not share one, the sign-in is refused and nothing is created.

If you already have an email-and-password account with the same verified address, signing in with Google or GitHub opens that same account rather than creating a second one. Your first sign-in by any method creates one workspace for you and asks three short questions.

## Sign-in and security

**Settings → Sign-in and security** lists your ways in:

- **Connect Google** or **Connect GitHub** adds that account as another way into this one. If that Google or GitHub account already belongs to a different Novera account, nothing is linked.
- **Disconnect** removes a connected account — never your last way in. Add a password or connect another account first.
- **Add a password** or **Change password**; changing one asks for the current password.
- **Sign out everywhere** ends every session, this one included. API keys are not affected; revoke those under Developer.

Each of these is recorded under **Recent changes** on the same page. Novera never stores or shows a provider's access token.
