#!/usr/bin/env node

import { runSetup } from "./setup-playwright-command.js";

process.exitCode = runSetup();
