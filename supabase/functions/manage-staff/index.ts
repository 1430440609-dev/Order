import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !publicKey || !adminKey || !authHeader) return reply(500, { error: "Server configuration is incomplete" });

  const caller = createClient(url, publicKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || !userData.user) return reply(401, { error: "Sign in is required" });

  const { data: profile, error: profileError } = await caller.from("profiles").select("role").eq("id", userData.user.id).single();
  if (profileError || profile?.role !== "admin") return reply(403, { error: "Administrator access is required" });

  const admin = createClient(url, adminKey, { auth: { persistSession: false } });
  let body: { action?: string; username?: string; password?: string; user_id?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Invalid JSON body" }); }

  if (body.action === "create") {
    const username = (body.username ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!/^[a-z0-9_-]{2,32}$/.test(username)) return reply(400, { error: "账号需为 2–32 位字母、数字、下划线或短横线" });
    if (password.length < 8) return reply(400, { error: "初始密码至少需要 8 位" });

    const { data, error } = await admin.auth.admin.createUser({
      email: username + "@orders.example.com",
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (error) return reply(400, { error: error.message });
    return reply(200, { id: data.user.id, username, role: "staff" });
  }

  if (body.action === "delete") {
    const userId = body.user_id ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return reply(400, { error: "Invalid user ID" });
    const { data: target, error: targetError } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (targetError) return reply(400, { error: targetError.message });
    if (!target || target.role === "admin") return reply(400, { error: "This account cannot be deleted here" });
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return reply(400, { error: error.message });
    return reply(200, { deleted: true });
  }

  return reply(400, { error: "Unsupported action" });
});

