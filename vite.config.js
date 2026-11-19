import { defineConfig } from 'vite';

// 三个页面：游戏本体（index.html）、球员一览（lineup.html）、大联盟球员分析（mlb-lab.html，独立分析用）
export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', lineup: 'lineup.html', mlbLab: 'mlb-lab.html' },
    },
  },
});
