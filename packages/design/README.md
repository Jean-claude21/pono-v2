# @pono/design

The single source of Pono's visual system (D-009): an achromatic base, Inter Tight and JetBrains
Mono, horizontal hairlines only, tabular figures, and the verdict banner. Colour only states a
project's condition. Light or dark follows the computer, or `data-theme="light|dark"` (D-022); the
console components (shell, cards, figures, bars, palette) live in `console.css`.

```css
@import '@pono/design/style.css';
```

Every visual change happens here first, and is rendered and looked at before it is proposed.
