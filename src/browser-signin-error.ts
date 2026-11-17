// Browser-only recovery. Never echo callback fields, cookies or upstream errors,
// and never clear a cookie: a competing callback may already have signed in.
export function browserSignInError(status: number, requestId: string, code: string) {
  const reference = /^req_[a-f0-9-]{36}$/.test(requestId) ? requestId : "unavailable";
  const reason = /^[a-z_]{1,64}$/.test(code) ? code : "signin_failed";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in needs attention | Atlas</title><style>body{margin:0;background:#f4f4f2;color:#171717;font-family:Arial,sans-serif}main{box-sizing:border-box;max-width:36rem;margin:12vh auto;padding:2rem;background:white;border:1px solid #d4d4d4}h1{font-size:1.75rem}p{line-height:1.6}nav{display:flex;flex-wrap:wrap;gap:1rem;margin:1.5rem 0}a{color:inherit;text-underline-offset:.25rem}a:first-child{background:#171717;color:white;padding:.75rem 1rem;text-decoration:none}small{display:block;overflow-wrap:anywhere;color:#525252}@media(max-width:40rem){main{margin:2rem 1rem;padding:1.5rem}}</style></head><body><main><p>CREATOR LABS / ATLAS</p><h1>Let’s get you back to Atlas</h1><p role="alert">This sign-in could not be completed. It may have expired or already been used.</p><p>Return to Atlas to check whether you’re already signed in. If not, start a new sign-in here. Don’t refresh or resubmit this callback.</p><nav aria-label="Sign-in recovery"><a href="/brain">Return to Atlas</a><a href="/auth/login">Start a new sign-in</a></nav><small>Reference: ${reference} / ${reason}</small></main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'sha256-rrZbZn64I1EjCPV5XtTVw+HrSIaoOyxuV71x4xlAfvA='; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Atlas-Signin-Error": reason, "X-Request-Id": reference,
    },
  });
}
