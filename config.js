// Supabase connection details.
//
// This file is COMMITTED, deliberately, and that is not an oversight.
//
// The anon key below is a public identifier, not a password. It says "this is
// the Task Manager app" and carries no permission of its own — the database
// rules in sql/schema.sql are what actually protect your data, and they let a
// signed-in user reach only rows matching their own account id. Every Supabase
// web app ships this key in its client bundle; that is how it is designed.
//
// It has to be committed because Vercel deploys from the git repo. A file left
// out by .gitignore simply does not exist at the deployed URL, so the site
// would 404 on this script and the app would never sign in.
//
// NEVER put a `sb_secret_...` key (or an older `service_role` JWT) in here, or
// anywhere else in this repo. Those bypass every rule above — anyone holding
// one can read and delete every user's tasks straight from the REST API. This
// app never needs one: it runs entirely in the browser.

window.TM_CONFIG = {
  url: 'https://dgavsfnnxaglfkrsjjqf.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnYXZzZm5ueGFnbGZrcnNqanFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwOTM5NjYsImV4cCI6MjEwNTY2OTk2Nn0.4Mu_dOfmFOUw25yoLZn-TTJOvqvdGWxLxzO9beSboDQ'
};
