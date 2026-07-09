from app.supabase_client import supabase
r = supabase.table("payment_proofs").select("*").execute()
print("COUNT:", len(r.data))
for row in r.data:
    print(f'  ID={row["id"][:8]}  org_id={row["org_id"]}  file={row["file_name"]}  status={row["status"]}')
