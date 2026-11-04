"""Exercise the real new migration on temporary PostgreSQL (pip install pgserver).

The legacy tables are minimal FK fixtures, not a complete Supabase stack.
No credentials or external database are used.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
import argparse
import re
import subprocess
import pgserver

ROOT = Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--single-user", action="store_true", help="Use PostgreSQL's socket-free single-user mode; skips concurrent-connection proof.")
    single = parser.parse_args().single_user
    with TemporaryDirectory(prefix="castora-reddit-db-") as directory:
        binaries = Path(pgserver.__file__).parent / "pginstall/bin"
        pgdata = Path(directory) / "data"
        if single:
            subprocess.run([str(binaries / "initdb"), "-D", str(pgdata), "--auth=trust"], check=True, capture_output=True)
        else:
            server = pgserver.get_server(pgdata, cleanup_mode="delete")
            uri = server.get_uri()
        def sql(statement, check=True):
            if single:
                flattened = " ".join(re.sub(r"--[^\n]*", "", statement).splitlines()) + "\n"
                result = subprocess.run([str(binaries / "postgres"), "--single", "-D", str(pgdata), "postgres"],
                                        input=flattened, text=True, capture_output=True)
                result.returncode = 1 if re.search(r"(?:ERROR|FATAL|PANIC):", result.stderr + result.stdout) else result.returncode
                result.stdout = "\n".join(re.findall(r'= "([^"\n]*)"', result.stdout))
            else:
                result = subprocess.run([str(binaries / "psql"), uri, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", statement],
                                        text=True, capture_output=True)
            if check and result.returncode:
                raise AssertionError(result.stderr)
            return result
        sql("""
          create role anon; create role authenticated; create role service_role bypassrls;
          create table public.profiles (id uuid primary key);
          create table public.characters (id uuid primary key);
          create table public.gallery_items (id uuid primary key);
        """)
        migration = ROOT / "supabase/migrations/20261104001807_reddit_automation.sql"
        sql(migration.read_text())
        owner = "10000000-0000-4000-8000-000000000001"
        char = "20000000-0000-4000-8000-000000000001"
        connection = "30000000-0000-4000-8000-000000000001"
        sql(f"insert into profiles values ('{owner}'); insert into characters values ('{char}');")
        sql(f"""insert into reddit_social_connections(id,owner_id,character_id,reddit_user_id,reddit_username,
           encrypted_access_token,encrypted_refresh_token,token_expires_at)
           values ('{connection}','{owner}','{char}','reddit-test-id','test','cipher','cipher',now()+interval '1 hour');""")
        assert sql("select enabled from reddit_social_connections").stdout.strip() == "f"
        assert sql(f"update reddit_social_connections set enabled=true where id='{connection}'", False).returncode != 0
        assert sql(f"update reddit_social_connections set posting_minutes=array[1440] where id='{connection}'", False).returncode != 0
        sql(f"""insert into reddit_social_posts(connection_id,owner_id,character_id,reddit_user_id,subreddit,local_date,slot,status,image_sha256,image_phash)
           values ('{connection}','{owner}','{char}','reddit-test-id','test',current_date,'10:00','sending','abc','0000000000000000');""")
        assert sql(f"""insert into reddit_social_posts(connection_id,owner_id,character_id,reddit_user_id,subreddit,local_date,slot,status)
           values ('{connection}','{owner}','{char}','reddit-test-id','test',current_date,'10:00','preparing');""", False).returncode != 0
        assert sql(f"""insert into reddit_social_posts(connection_id,owner_id,character_id,reddit_user_id,subreddit,local_date,slot,status,image_sha256)
           values ('{connection}','{owner}','{char}','reddit-test-id','other',current_date,'15:00','preparing','abc');""", False).returncode != 0
        for table in ["reddit_social_connections", "reddit_oauth_sessions", "reddit_social_posts", "reddit_community_candidates", "reddit_publishing_locks"]:
            assert sql(f"select relrowsecurity from pg_class where oid='public.{table}'::regclass").stdout.strip() == "t"
            for role in ["anon", "authenticated"]:
                assert sql(f"select has_table_privilege('{role}','public.{table}','SELECT')").stdout.strip() == "f"
                assert sql(f"set role {role}; select * from public.{table}", False).returncode != 0
            assert sql(f"select has_table_privilege('service_role','public.{table}','SELECT,INSERT,UPDATE,DELETE')").stdout.strip() == "t"
        def claim(index):
            return sql(f"insert into reddit_publishing_locks values ('{owner}','40000000-0000-4000-8000-00000000000{index}',now()+interval '10 minutes')", False).returncode
        if single:
            results = list(map(claim, [1, 2]))
        else:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(claim, [1, 2]))
        assert sum(result == 0 for result in results) == 1
        sql(f"delete from reddit_social_connections where id='{connection}'")
        assert sql("select count(*) from reddit_social_posts where connection_id is null and reddit_user_id='reddit-test-id'").stdout.strip() == "1"
        print("PASS: PostgreSQL migration, RLS/grants, default-off activation, slot/image uniqueness, owner-lease uniqueness and retained disconnect history.")
        print("CONCURRENCY: skipped (socket-free single-user mode)." if single else "CONCURRENCY: two live connections verified one owner-lease winner.")

if __name__ == "__main__":
    main()
