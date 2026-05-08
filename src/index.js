export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    if (host === "www.app.authtoolkit.com") {
      url.hostname = "app.authtoolkit.com";
      return Response.redirect(url.toString(), 301);
    }

    if (host === "www.authtoolkit.com") {
      url.hostname = "app.authtoolkit.com";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
