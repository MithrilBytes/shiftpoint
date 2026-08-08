import sqlite3

from flask import Flask, g, render_template, request, redirect

DATABASE = "links.db"

app = Flask(__name__)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


@app.route("/")
def index():
    rows = get_db().execute("SELECT url, title FROM links ORDER BY id DESC").fetchall()
    return render_template("index.html", links=rows)


@app.route("/add", methods=["POST"])
def add():
    db = get_db()
    db.execute(
        "INSERT INTO links (url, title) VALUES (?, ?)",
        (request.form["url"], request.form["title"]),
    )
    db.commit()
    return redirect("/")


if __name__ == "__main__":
    app.run()
