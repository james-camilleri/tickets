#!/usr/bin/env node

import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'

import {
  configureGit,
  configureNetlify,
  configureSanity,
  createProjectDir,
  getProjectInfo,
  installDependencies,
  // replacePlaceholders,
} from './installation-scripts/index.mjs'
import { replacePlaceholdersInFile } from './utils/file.mjs'
import { copyDir } from './utils/file.mjs'

async function initialise() {
  const defaults = { name: process.argv[2] }
  const cwd = defaults.name || '.'

  await createProjectDir(cwd)

  const projectInfo = await getProjectInfo(defaults)

  const packageName = projectInfo.name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z0-9~.-]+/g, '')

  console.log()
  console.log('Copying templates.')
  await copyDir(fileURLToPath(new URL(`./template`, import.meta.url).href), cwd)

  // npm won't publish .gitignore, so we need to save
  // it under a different name and then rename it.
  await fs.rename(`${cwd}/gitignore`, `${cwd}/.gitignore`)

  console.log()
  console.log('Installing dependencies.')
  await installDependencies(
    {
      dependencies: ['@james-camilleri/replace-sanity-favicon', 'nodemailer'],
      devDependencies: ['@netlify/functions', '@the-gods/box-office', 'env-cmd', 'ts-node'],
    },
    `${cwd}/sites/cms`,
  )
  await installDependencies(
    {
      devDependencies: ['@the-gods/box-office'],
    },
    `${cwd}/sites/web`,
  )

  console.log()
  console.log('Initialising Sanity project.')
  const sanityConfig = await configureSanity({ name: projectInfo.name, dest: `${cwd}/sites/cms` })

  // Re-copy files that `create sanity` has overwritten.
  await copyDir(
    fileURLToPath(new URL(`./template/sites/cms`, import.meta.url).href),
    `${cwd}/sites/cms`,
  )

  const dictionary = {
    ...sanityConfig,
    name: packageName,
  }

  console.log()
  console.log('Replacing template placeholders.')
  await Promise.all(
    ['/sites/cms/package.json', '/sites/web/package.json'].map((path) =>
      replacePlaceholdersInFile(`${cwd}/${path}`, dictionary),
    ),
  )

  if (projectInfo.initGit) {
    console.log()
    console.log('Initialising git repository.')
    await configureGit(cwd, projectInfo.pushToGitHub, packageName)
  }

  if (projectInfo.configNetlify) {
    console.log()
    console.log('Configuring Netlify.')
    await configureNetlify(`${cwd}/sites/web`, `${cwd}/sites/cms`)
  }
}

initialise()