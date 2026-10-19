#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillsRepoRoot = path.resolve(__dirname, '..');
const skillsDir = path.join(skillsRepoRoot, 'skills');

console.log('🔍 Validating NitroStack Skills Registry v2.0.0...\n');

// 1. Verify package.json
const pkgPath = path.join(skillsRepoRoot, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error('❌ package.json missing!');
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== '2.0.0') {
  console.error(`❌ Expected package.json version 2.0.0, found: ${pkg.version}`);
  process.exit(1);
}
console.log(`✅ package.json: Version is ${pkg.version}`);

// 2. Discover skill directories
const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

console.log(`\n📦 Discovered ${skillDirs.length} skill directories:`);
for (const dir of skillDirs) {
  console.log(`   - ${dir}`);
}

if (skillDirs.length !== 12) {
  console.error(`❌ Expected exactly 12 skills, but found ${skillDirs.length}`);
  process.exit(1);
}
console.log('✅ Exactly 12 skills found.');

// 3. Validate each SKILL.md and YAML frontmatter
let allFrontmatterValid = true;

for (const skill of skillDirs) {
  const skillFile = path.join(skillsDir, skill, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    console.error(`❌ Missing SKILL.md in: skills/${skill}`);
    allFrontmatterValid = false;
    continue;
  }

  const content = fs.readFileSync(skillFile, 'utf8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    console.error(`❌ Missing YAML frontmatter in: skills/${skill}/SKILL.md`);
    allFrontmatterValid = false;
    continue;
  }

  const frontmatterRaw = frontmatterMatch[1];
  const nameMatch = frontmatterRaw.match(/^name:\s*([^\n]+)/m);
  const descMatch = frontmatterRaw.match(/^description:\s*([^\n]+)/m);

  if (!nameMatch || !nameMatch[1].trim()) {
    console.error(`❌ Missing or empty 'name' frontmatter in: skills/${skill}/SKILL.md`);
    allFrontmatterValid = false;
  } else {
    const name = nameMatch[1].trim();
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.error(`❌ Invalid skill name format '${name}' in: skills/${skill}/SKILL.md`);
      allFrontmatterValid = false;
    }
  }

  if (!descMatch || !descMatch[1].trim()) {
    console.error(`❌ Missing or empty 'description' frontmatter in: skills/${skill}/SKILL.md`);
    allFrontmatterValid = false;
  }
}

if (!allFrontmatterValid) {
  console.error('\n❌ Frontmatter validation failed.');
  process.exit(1);
}
console.log('✅ All 12 SKILL.md files contain valid YAML frontmatter (name & description).');

// 4. Validate skills/README.md catalog
const readmePath = path.join(skillsRepoRoot, 'README.md');
if (!fs.existsSync(readmePath)) {
  console.error('❌ skills/README.md missing!');
  process.exit(1);
}
const readmeContent = fs.readFileSync(readmePath, 'utf8');
for (const skill of skillDirs) {
  if (!readmeContent.includes(`skills/${skill}/SKILL.md`)) {
    console.error(`❌ skills/README.md does not link to skills/${skill}/SKILL.md`);
    process.exit(1);
  }
}
console.log('✅ skills/README.md catalog links all 12 skills.');

// 5. Run validate_ascii_box.py across all markdown files
console.log('\n🎨 Validating ASCII box diagrams across all skills & README...');
const validatorPath = '/Users/admin/.gemini/config/skills/ascii-diagram/scripts/validate_ascii_box.py';

const mdFilesToValidate = [
  readmePath,
  ...skillDirs.map((dir) => path.join(skillsDir, dir, 'SKILL.md')),
];

let allBoxesPassed = true;
for (const mdFile of mdFilesToValidate) {
  try {
    const out = execFileSync('python3', [validatorPath, mdFile], { encoding: 'utf8' });
    if (!out.includes('PASSED')) {
      console.error(`❌ Box validation failed for ${path.relative(skillsRepoRoot, mdFile)}:\n${out}`);
      allBoxesPassed = false;
    }
  } catch (err) {
    console.error(`❌ Box validation error in ${path.relative(skillsRepoRoot, mdFile)}:\n${err.stdout || err.message}`);
    allBoxesPassed = false;
  }
}

if (!allBoxesPassed) {
  console.error('\n❌ ASCII diagram validation failed.');
  process.exit(1);
}
console.log('✅ All ASCII diagrams across README.md and 12/12 skills are pixel-perfect and aligned.');

console.log('\n🚀 ALL MILESTONE 6 REGISTRY RELEASE VALIDATIONS PASSED SUCCESSFULLY!');
