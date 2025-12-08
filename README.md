# AI Privacy Audit (Obsidian Plugin)

Run a pragmatic privacy & security audit on the current note using the OpenAI API.

- Adds a command: **Run privacy/security audit on current note**
- Sends the note text to an OpenAI model with a safety-focused system prompt
- Shows results in a side panel so you can edit and review side by side

## Installation (manual)

1. Download `main.js` and `manifest.json`.
2. Put them in a folder named `privacy-audit` inside your vault at:
   `.obsidian/plugins/privacy-audit/`
3. Enable the plugin in **Settings → Community plugins**.
4. Set your OpenAI API key in the plugin settings.

## Development

```bash
npm install
npm run build
```

The above commands will generate a new `main.js` file after any changes. You can then update the plugin folder with this file and reload the plugin in Obsidian.

## Examples

Below are example screenshots showing the plugin running inside Obsidian.

### Running the Audit from the Command Palette**
![Command Palette Example](assets/dontspearphishme-command-palette.png)

---

### Catching a reveal of a personal routine

![Example 1](assets/dontspearphishme-example1.png)

---

### Catching a reveal of corporate and device information

![Example 2](assets/dontspearphishme-example2.png)

---

### Good note that passes checks

![Example 3](assets/dontspearphishme-example3.png)

---