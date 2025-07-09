export async function serveStaticFile(path: string): Promise<Response> {
  try {
    const file = await Deno.readFile(path);
    const contentType = path.endsWith(".css") ? "text/css" :
                       path.endsWith(".js") ? "application/javascript" :
                       "text/html";
    return new Response(file, {
      headers: { "content-type": contentType },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
