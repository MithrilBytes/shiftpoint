const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

const links = new Map([
  ["docs", "https://example.com/docs"],
  ["status", "https://status.example.com"],
]);

app.get("/healthz", (req, res) => res.send("ok"));

app.get("/:slug", (req, res) => {
  const target = links.get(req.params.slug);
  if (!target) return res.status(404).send("Not found");
  res.redirect(302, target);
});

app.listen(port, () => console.log(`shortlink listening on ${port}`));
