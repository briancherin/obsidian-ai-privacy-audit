import {
	App,
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	ItemView,
	WorkspaceLeaf,
	requestUrl,
} from "obsidian";

interface PrivacyAuditSettings {
	openaiApiKey: string;
	model: string;
	systemPrompt: string;
	maxTokens: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a pragmatic privacy, security, and OSINT risk auditor for personal notes and blog posts.

Your job is to highlight ONLY clearly high-risk issues that a realistic blogger should actually fix. Treat normal human self-expression as acceptable. Do NOT flag or over-explain low- or medium-risk items.

Think in terms of: “Would this materially help a malicious stranger target or impersonate this person?”

Classify something as HIGH-RISK when it clearly fits one of these categories:

1. Specific people and identities
   - Full names of other private individuals (friends, coworkers, family) who did not choose to be public.
   - The author’s full legal name, if the text suggests the blog is meant to be pseudonymous.
   - Names paired with strong context that makes them easily searchable (e.g., “my boss John Smith at XCompany in [city]”).

2. Locations and routines
   - Home address, apartment number, building name, or very precise home location.
   - Detailed travel plans in the future with specific dates AND places AND lodging details.
   - ANY repeated routine (daily/weekly/etc.) that includes BOTH:
     - a time or time window (specific or approximate, e.g. “around 6pm”, “before work”, “after my 9–5”), AND
     - a reasonably specific place (park entrance, specific bar, gym, subway station, recurring meetup venue, etc.).
     These predictable routines are ALWAYS high-risk, even if everything else in the note seems harmless.

3. Workplace and sensitive professional context
   - Exact company + team + city combined with internal tools, incidents, or confidential-sounding details.
   - Information that would make it easy for an attacker to impersonate IT/security/HR for that workplace.

4. Accounts, secrets, and security posture
   - Usernames or IDs tied to sensitive accounts (email, banking, GitHub, cloud, password managers) WHEN they are clearly real and in active use.
   - API keys, access tokens, secrets, private URLs, or webhook endpoints of any kind.
   - Very weak security habits described in a way that would be trivial to exploit (e.g., “I use the same password for everything and never use 2FA”).

5. Anything that would be obviously regrettable if shown to a stranger who wanted to harm or harass the author.

When in doubt about a borderline detail:
- If it clearly allows tracking or impersonation by itself, treat as HIGH-RISK.
- If it only becomes risky when combined with other info and is very typical for personal blogging, at most mention it as a minor observation.

OUTPUT FORMAT (markdown):

Start with a short summary (1–3 sentences).

Then:

## High-Risk Items
- If there are high-risk issues, list each as:
  - **Snippet:** short quote or paraphrase
  - **Why it’s risky:** one or two sentences, focused on attacker use
  - **Suggested change:** a practical rewrite or mitigation
- If there are no high-risk items, say:
  - “No clear high-risk privacy or security issues detected. This post looks reasonable for a typical personal blog.”

## Optional Minor Observations
- At most 3 quick bullets for optional small improvements.
- Only include items that are genuinely useful to consider; skip vague or nitpicky advice entirely.
`;

const DEFAULT_SETTINGS: PrivacyAuditSettings = {
	openaiApiKey: "",
	model: "gpt-4.1-mini",
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	maxTokens: 900,
};

const PRIVACY_AUDIT_VIEW = "privacy-audit-view";

interface OpenAIChatCompletionResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

export default class PrivacyAuditPlugin extends Plugin {
	settings!: PrivacyAuditSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PrivacyAuditSettingTab(this.app, this));

		this.addCommand({
			id: "run-audit",
			name: "Run privacy and security audit on current note",
			// Expectation is a void callback, so intentionally ignore the promise
			editorCallback: (editor: Editor, _ctx: MarkdownView | MarkdownFileInfo) => {
				void this.runAudit(editor);
			},
		});

		this.registerView(PRIVACY_AUDIT_VIEW, (leaf) => new PrivacyAuditView(leaf));
	}

	onunload() {
		// nothing special
	}

	private async loadSettings() {
		const stored = (await this.loadData()) as Partial<PrivacyAuditSettings> | null | undefined;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async runAudit(editor: Editor) {
		const apiKey = this.settings.openaiApiKey.trim();
		if (!apiKey) {
			new Notice("Privacy audit: please set your OpenAI API key in the plugin settings.");
			return;
		}

		const content = editor.getValue();
		if (!content || content.trim().length === 0) {
			new Notice("Privacy audit: current note is empty.");
			return;
		}

		new Notice("Privacy audit: running audit…");

		try {
			const responseText = await this.callOpenAI(apiKey, content);
			await this.showAuditInSidebar(responseText);
			new Notice("Privacy audit: results written to side panel.");
		} catch (err: unknown) {
			let msg = "Privacy audit: failed to get response from OpenAI.";
			if (err instanceof Error && err.message) {
				msg += ` ${err.message}`;
			}
			new Notice(msg);
		}
	}

	private async callOpenAI(apiKey: string, noteContent: string): Promise<string> {
		const model = this.settings.model || "gpt-4.1-mini";
		const systemPrompt = this.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
		const maxTokens = this.settings.maxTokens || 900;

		const response = await requestUrl({
			url: "https://api.openai.com/v1/chat/completions",
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content: `Here is the full text of my note. Please perform the privacy and security audit described:\n\n${noteContent}`,
					},
				],
				temperature: 0.1,
				max_tokens: maxTokens,
			}),
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`OpenAI API error: ${response.status} - ${response.text}`);
		}

		const parsed = JSON.parse(response.text) as unknown as OpenAIChatCompletionResponse;
		const message = parsed.choices?.[0]?.message?.content;

		if (!message) {
			throw new Error("OpenAI API returned no message content.");
		}

		return message;
	}

	private async showAuditInSidebar(auditText: string) {
		let leaf = this.app.workspace.getLeavesOfType(PRIVACY_AUDIT_VIEW)[0];

		// If no leaf exists, create one in the right sidebar
		if (!leaf) {
			const created = this.app.workspace.getRightLeaf(false);
			if (!created) {
				new Notice("Privacy audit: could not open the side panel for results.");
				return;
			}

			await created.setViewState({
				type: PRIVACY_AUDIT_VIEW,
				active: true,
			});

			leaf = created; // now safe because it's guaranteed non-null
		}

		const view = leaf.view as PrivacyAuditView;
		view.setContent(auditText);
	}
}

class PrivacyAuditSettingTab extends PluginSettingTab {
	plugin: PrivacyAuditPlugin;

	constructor(app: App, plugin: PrivacyAuditPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("OpenAI API key")
			.setDesc("Stored locally in this vault's plugin data. Treat this vault as sensitive.")
			.addText((text) =>
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("OpenAI model name (for example: gpt-4.1-mini, gpt-4.1, o4-mini)")
			.addText((text) =>
				text
					.setPlaceholder("gpt-4.1-mini")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Max tokens")
			.setDesc("Upper bound for response length (affects cost).")
			.addText((text) =>
				text
					.setPlaceholder("900")
					.setValue(String(this.plugin.settings.maxTokens))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!Number.isNaN(num)) {
							this.plugin.settings.maxTokens = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("System prompt")
			.setDesc("Advanced: customize how the AI reviews your note.")
			.addTextArea((text) =>
				text
					.setPlaceholder("System prompt...")
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}

class PrivacyAuditView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return PRIVACY_AUDIT_VIEW;
	}

	getDisplayText(): string {
		return "Privacy audit";
	}

	getIcon(): string {
		return "shield-half";
	}

	setContent(markdown: string): void {
		// Obsidian's view container: children[0] = header, children[1] = main content
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		const pre = container.createEl("pre", { cls: "privacy-audit-output" });
		pre.textContent = markdown;
	}
}
