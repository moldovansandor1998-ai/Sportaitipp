# Production authentication fix

The API routes now validate the incoming bearer token without duplicating the Authorization header. Reference image upload uses Supabase signed upload and reports configuration failures explicitly.
