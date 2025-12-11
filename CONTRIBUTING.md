# Contributing to QuoteVaultPro (TitanOS)

Welcome to QuoteVaultPro! This guide will help you understand how to contribute changes to the project.

## 📋 Quick Start: Merging New Edits

### Option 1: GitHub Pull Request (Recommended)

If you've been working on a feature branch and want to merge your changes into the default branch:

1. **Ensure your changes are committed and pushed**
   ```bash
   git status                    # Check what's changed
   git add .                     # Stage all changes
   git commit -m "Your message"  # Commit with descriptive message
   git push origin your-branch   # Push to GitHub
   ```

2. **Create a Pull Request on GitHub**
   - Go to https://github.com/Tombstone73/QuoteVaultPro
   - Click "Pull requests" → "New pull request"
   - Select your branch as the source
   - Select the default branch (usually `main` or `master`) as the target
   - Add a clear title and description
   - Click "Create pull request"

3. **Review and Merge**
   - Wait for any CI/CD checks to complete
   - Review the changes in the PR
   - Click "Merge pull request" when ready
   - Choose merge strategy (usually "Create a merge commit")
   - Click "Confirm merge"

4. **Clean up (Optional)**
   ```bash
   git checkout main              # Switch to default branch
   git pull origin main           # Get the merged changes
   git branch -d your-branch      # Delete local branch
   git push origin --delete your-branch  # Delete remote branch
   ```

### Option 2: Direct Merge (Local)

⚠️ **Note**: Direct merges bypass code review. Use Pull Requests when possible.

```bash
# Make sure all changes are committed
git status
git add .
git commit -m "Your changes"

# Switch to the default branch
git checkout main  # or master, depending on your repo

# Pull latest changes
git pull origin main

# Merge your feature branch
git merge your-branch-name

# Push the merged changes
git push origin main
```

## 🔄 Standard Workflow

### For New Features

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the [TitanOS Development Flow](docs/DEVELOPMENT_FLOW.md)
   - Keep changes focused and minimal
   - Test thoroughly

3. **Commit frequently**
   ```bash
   git add .
   git commit -m "feat: add specific feature"
   ```

4. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a Pull Request on GitHub

### For Bug Fixes

1. **Create a fix branch**
   ```bash
   git checkout -b fix/bug-description
   ```

2. **Fix the issue**
   - Identify the root cause
   - Make minimal changes
   - Test the fix

3. **Commit and push**
   ```bash
   git add .
   git commit -m "fix: resolve specific bug"
   git push origin fix/bug-description
   ```

4. **Create PR** for review and merge

## 📝 Commit Message Guidelines

Use conventional commit format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add invoice PDF generation
fix: resolve quote calculation error
docs: update API documentation
refactor: simplify pricing calculator
```

## 🧪 Testing Before Merge

Always test your changes before merging:

```bash
# Install dependencies
npm install

# Run type checking
npm run check

# Build the project
npm run build

# Run tests (if available)
npm test

# Run the development server
npm run dev
```

## 🏗️ Code Standards

- **Multi-tenancy**: Always filter by `organizationId`
- **Validation**: Use Zod schemas from `shared/schema.ts`
- **Auth**: Apply proper middleware (`isAuthenticated`, `tenantContext`)
- **TypeScript**: Maintain type safety
- **Minimal changes**: Make the smallest change that works
- **Follow existing patterns**: Match the style of surrounding code

## 📚 Additional Resources

- [Architecture Documentation](docs/ARCHITECTURE.md)
- [Development Flow](docs/DEVELOPMENT_FLOW.md)
- [Module Dependencies](docs/MODULE_DEPENDENCIES.md)
- [Git Workflow Details](docs/GIT_WORKFLOW.md)

## 🆘 Getting Help

If you run into issues:

1. Check existing documentation in `/docs`
2. Review the [TitanOS kernel instructions](.github/copilot-instructions.md)
3. Look at recent PRs for examples
4. Ask for guidance in GitHub issues or discussions

## 🚀 Common Scenarios

### Scenario: "I made changes directly on main and need to move them to a PR"

```bash
# Create a new branch with your current changes
git checkout -b feature/my-changes

# Reset main to match origin
git checkout main
git reset --hard origin/main

# Now create a PR from your feature branch
git checkout feature/my-changes
git push origin feature/my-changes
```

### Scenario: "My branch is behind the default branch"

```bash
# Update your branch with latest changes from main
git checkout your-branch
git fetch origin
git merge origin/main
# Or use rebase: git rebase origin/main

# Resolve any conflicts if they occur
# Then push
git push origin your-branch
```

### Scenario: "I need to update a PR with new changes"

```bash
# Make your changes
git add .
git commit -m "Address review feedback"
git push origin your-branch

# The PR will automatically update
```

## ⚠️ Important Notes

- **Never force push** to shared branches
- **Always pull before pushing** to avoid conflicts
- **Use branches** for all changes, don't work directly on main
- **Test locally** before creating a PR
- **Write clear commit messages** for future reference
- **Keep PRs focused** - one feature or fix per PR

---

Thank you for contributing to QuoteVaultPro! 🎉
