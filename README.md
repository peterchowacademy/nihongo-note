# 日本語ノート — JLPT N5 Notebook (v0.2.1)

A self-study notebook for JLPT N5: vocabulary, phrases and dialogues, grammar notes, number and counter tables,
verb conjugation, particles, listening practice and a JLPT-format quiz with a mock exam.

Released 2026-11-15. Language proficiency: N5.

## Use it offline

- **Multi-file version:** open `index.html` in a browser. Keep the `css/` and `js/` folders next to it.
- **Single-file version:** `standalone/nihongo-note.html` is the whole notebook in one file. Copy it anywhere and double-click.

No server, build step or account is needed.

## Publish it on GitHub Pages

1. Create a repository and upload everything in this folder (`index.html` must be at the top level).
2. In the repository, open Settings → Pages, choose "Deploy from a branch", pick your main branch and the `/ (root)` folder, and save.
3. After a minute or two the notebook is served at `https://<your-username>.github.io/<repository-name>/`.

The empty `.nojekyll` file tells GitHub Pages to serve the files as they are.

## Files

| File | Contents |
|---|---|
| `index.html` | Page structure |
| `css/style.css` | All styles (light and dark theme) |
| `js/data-vocab.js` | Vocabulary, phrases, dialogues and grammar entries |
| `js/data-drills.js` | Number tables, verb list, particles, listening scripts, quiz banks |
| `js/app.js` | Application logic |
| `standalone/nihongo-note.html` | Everything above in one file |

To add or correct content, edit the two data files; the entry format is one object per line.

## Things to know

- **Your own words and edits** are saved in the browser's local storage on each device. They are not stored in these files and do not sync between devices or visitors.
- **Audio** uses the browser's built-in Japanese speech voice. If nothing plays, install a Japanese voice in the system settings.
- **Fonts:** the Japanese display font loads from Google Fonts when online; offline, the system font is used.
- **External links** (Jisho, the JLPT sample page, YouTube) need an internet connection.

## About the content

All example sentences, dialogues and quiz questions were written for this notebook. The quiz follows the question types of
the JLPT N5 but does not contain official test questions. This project is not affiliated with the Japan Foundation, JEES,
or any textbook publisher. For official sample questions, see https://www.jlpt.jp/e/samples/sample09.html

Add a licence of your choice before publishing.
