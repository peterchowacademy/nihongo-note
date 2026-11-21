# 日本語ノート — JLPT N5 Notebook (v0.3.2)

A self-study notebook for JLPT N5: vocabulary, phrases and dialogues, grammar notes, number and counter tables,
verb conjugation, particles, listening practice, question patterns from past papers, and a JLPT-format quiz with a mock exam.

Released 2026-11-21. Language proficiency: N5.

## Use it offline

- **Multi-file version:** open `index.html` in a browser. Keep the `css/` and `js/` folders next to it.
- **Single-file version:** `standalone/nihongo-note.html` is the whole notebook in one file. Copy it anywhere and double-click.

No server, build step or account is needed.

## Publish it on GitHub Pages (first time)

1. Create a repository and upload everything in this folder (`index.html` must be at the top level).
2. In the repository, open Settings → Pages, choose "Deploy from a branch", pick your main branch and the `/ (root)` folder, and save.
3. After a minute or two the notebook is served at `https://<your-username>.github.io/<repository-name>/`.

The empty `.nojekyll` file tells GitHub Pages to serve the files as they are.

## Releasing a new version

1. Unzip the new release.
2. In the repository, replace the old files with the new ones: `index.html`, the `css/` and `js/` folders, `standalone/` and `README.md`.
3. Commit and push (or use "Add file → Upload files" on github.com and commit).
4. GitHub Pages rebuilds automatically within a minute or two. If the old page still shows, do a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac).

Each visitor's own words and edits are kept in their browser, so a new release does not erase them.

## Files

| File | Contents |
|---|---|
| `index.html` | Page structure |
| `css/style.css` | All styles (light and dark theme) |
| `js/data-vocab.js` | Vocabulary, phrases, dialogues and grammar entries |
| `js/data-drills.js` | Number tables, verb list, particles, listening scripts, question patterns, quiz banks |
| `js/app.js` | Application logic |
| `standalone/nihongo-note.html` | Everything above in one file |

To add or correct content, edit the two data files; the entry format is one object per line.

## Things to know

- **Your own words and edits** are saved in the browser's local storage on each device. They are not stored in these files and do not sync between devices or visitors.
- **Audio** uses the browser's built-in Japanese speech voice. If nothing plays, install a Japanese voice in the system settings.
- **Fonts:** the Japanese display font loads from Google Fonts when online; offline, the system font is used.
- **External links** (Jisho, the JLPT sample page, YouTube) need an internet connection.

## About the content

The quiz questions, dialogues and example sentences were written for this notebook. The 設問 tab lists question
patterns found in the JLPT N5 sample papers (2009, 2012, 2018) as templates with new example sentences; it does not
contain the papers' test items. This project is not affiliated with the Japan Foundation, JEES, or any textbook
publisher. Official sample questions: https://www.jlpt.jp/e/samples/sample09.html
