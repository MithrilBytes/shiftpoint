const express = require("express");
const { formatMoney } = require("@acme/shared");

const app = express();

app.get("/quote/:cents", (req, res) => {
  res.json({ display: formatMoney(Number(req.params.cents)) });
});

app.listen(process.env.PORT || 4000);
