# Git Workflow Guide for QuoteVaultPro (TitanOS)

This document provides detailed git workflows for contributing to QuoteVaultPro.

---

## 🌳 Branch Strategy

### Main Branches

- **`main`** (or `master`) - Production-ready code
  - Always stable
  - Only receives changes via Pull Requests
  - Protected branch (no direct pushes)

### Feature Branches

Feature branches are created for new functionality:

```bash
git checkout -b feature/description-of-feature
```

**Naming conventions:**
- `feature/` - New features (`feature/invoice-pdf-export`)
- `fix/` - Bug fixes (`fix/quote-calculation-error`)
- `refactor/` - Code refactoring (`refactor/pricing-engine`)
- `docs/` - Documentation (`docs/api-reference`)
- `test/` - Adding tests (`test/order-workflow`)
- `copilot/` - Copilot-generated changes (`copilot/task-description`)

---

## 🔄 Complete Merge Workflow

### Step 1: Start with a Clean Branch

```bash
# Ensure you're on the default branch
git checkout main

# Get the latest changes
git pull origin main

# Create your feature branch
git checkout -b feature/your-feature
```

### Step 2: Make Changes

```bash
# Make your code changes
# Edit files, test changes, etc.

# Check what you've changed
git status
git diff

# Stage your changes
git add .
# Or stage specific files: git add path/to/file

# Commit with a clear message
git commit -m "feat: implement invoice PDF generation"
```

### Step 3: Push Your Branch

```bash
# Push your branch to GitHub
git push origin feature/your-feature

# If this is the first push, you might need:
git push -u origin feature/your-feature
```

### Step 4: Create a Pull Request

**On GitHub:**

1. Navigate to https://github.com/Tombstone73/QuoteVaultPro
2. Click "Pull requests"
3. Click "New pull request"
4. Select:
   - **Base**: `main` (the branch you want to merge INTO)
   - **Compare**: `feature/your-feature` (your branch)
5. Fill in the PR template:
   - **Title**: Clear, descriptive title
   - **Description**: What changes were made and why
   - **Testing**: How you tested the changes
   - **Screenshots**: If UI changes were made
6. Click "Create pull request"

### Step 5: Review and Address Feedback

```bash
# If reviewers request changes, make them on your branch
git checkout feature/your-feature

# Make the requested changes
# Edit files...

# Commit the updates
git add .
git commit -m "Address review feedback: fix validation logic"

# Push the updates
git push origin feature/your-feature

# The PR automatically updates with your new commits
```

### Step 6: Merge the Pull Request

**Once approved, on GitHub:**

1. Ensure all checks pass (CI/CD, tests, etc.)
2. Click "Merge pull request"
3. Choose merge strategy:
   - **Create a merge commit** (recommended) - Preserves full history
   - **Squash and merge** - Combines all commits into one
   - **Rebase and merge** - Linear history
4. Click "Confirm merge"

### Step 7: Clean Up

```bash
# Switch back to main
git checkout main

# Pull the merged changes
git pull origin main

# Delete your local branch (optional)
git branch -d feature/your-feature

# Delete the remote branch (optional, or use GitHub UI)
git push origin --delete feature/your-feature
```

---

## 🔧 Advanced Git Operations

### Updating Your Branch with Latest Main

If your feature branch becomes outdated:

```bash
# On your feature branch
git checkout feature/your-feature

# Fetch latest changes
git fetch origin

# Option 1: Merge main into your branch
git merge origin/main

# Option 2: Rebase your branch on main (cleaner history)
git rebase origin/main

# If using rebase, you may need to force push
git push origin feature/your-feature --force-with-lease
```

### Handling Merge Conflicts

If conflicts occur during merge or rebase:

```bash
# Git will tell you which files have conflicts
git status

# Open conflicting files and look for markers:
# <<<<<<< HEAD
# Your changes
# =======
# Changes from main
# >>>>>>> origin/main

# Edit the files to resolve conflicts
# Remove the markers and keep the correct code

# Stage the resolved files
git add path/to/resolved-file

# Continue the merge or rebase
git merge --continue
# Or: git rebase --continue

# Push the resolution
git push origin feature/your-feature
```

### Amending the Last Commit

If you need to fix the most recent commit:

```bash
# Make your changes
git add .

# Amend the last commit
git commit --amend

# Update the commit message if needed
# Or keep it the same with: git commit --amend --no-edit

# Force push (only if you haven't pushed yet, or only you are using the branch)
git push origin feature/your-feature --force-with-lease
```

### Cherry-Picking Commits

To apply specific commits from another branch:

```bash
# Find the commit hash you want
git log other-branch

# Apply it to your current branch
git cherry-pick <commit-hash>

# Push the change
git push origin current-branch
```

### Stashing Changes

Save work in progress without committing:

```bash
# Save your current changes
git stash

# Or with a message:
git stash save "WIP: working on feature X"

# Switch branches and do other work
git checkout other-branch

# Come back and restore your changes
git checkout feature/your-feature
git stash pop

# Or apply without removing from stash:
git stash apply
```

---

## 📊 Workflow Diagrams

### Standard Feature Workflow

```
main branch:        ─────●─────────────●──────→
                         │             │
feature branch:          └──●──●──●──●─┘
                           commit commits
                              ↓
                           push to GitHub
                              ↓
                          Create PR
                              ↓
                           Review
                              ↓
                        Merge to main
```

### Keeping Branch Updated

```
main branch:        ─────●─────●─────●──────→
                         │           ↓
feature branch:          └──●──●──●──●──●──→
                                    ↑
                              merge main
                           (or rebase)
```

---

## 🎯 Best Practices

### DO:

✅ Create a new branch for every change  
✅ Write clear, descriptive commit messages  
✅ Pull latest changes before starting work  
✅ Test your changes before creating a PR  
✅ Keep PRs focused and small  
✅ Address review feedback promptly  
✅ Delete branches after merging  

### DON'T:

❌ Work directly on `main` branch  
❌ Force push to shared branches  
❌ Commit broken code  
❌ Include unrelated changes in one PR  
❌ Push sensitive data (credentials, keys)  
❌ Leave branches unmerged for long periods  

---

## 🚨 Common Issues and Solutions

### Issue: "I accidentally committed to main"

```bash
# Create a branch with your changes
git branch feature/my-changes

# Reset main to match origin
git reset --hard origin/main

# Switch to your new branch
git checkout feature/my-changes

# Push and create PR
git push origin feature/my-changes
```

### Issue: "I need to undo my last commit"

```bash
# Keep changes, undo commit
git reset --soft HEAD~1

# Discard changes and commit
git reset --hard HEAD~1
```

### Issue: "My branch diverged from origin"

```bash
# See what happened
git status

# Option 1: Pull with rebase
git pull --rebase origin feature/your-branch

# Option 2: Force push your version (USE WITH CAUTION)
git push origin feature/your-branch --force-with-lease
```

### Issue: "I want to merge without a PR" (Local merge)

```bash
# Make sure everything is committed
git status

# Switch to main
git checkout main

# Pull latest
git pull origin main

# Merge your branch
git merge feature/your-branch

# Push to origin
git push origin main
```

⚠️ **Warning**: Local merges bypass code review. Always prefer Pull Requests.

---

## 🔍 Checking Your Work

Before pushing or creating a PR:

```bash
# Check status
git status

# View your changes
git diff

# View commit history
git log --oneline -10

# See what will be pushed
git diff origin/main..HEAD

# Check branch differences
git diff main...feature/your-branch
```

---

## 🤝 Collaboration Tips

### Working on the Same Branch

If multiple people work on one branch:

```bash
# Always pull before pushing
git pull origin feature/shared-branch

# If conflicts occur, resolve them
# Then push your changes
git push origin feature/shared-branch
```

### Code Review Workflow

**As a reviewer:**
1. Review the code on GitHub
2. Leave inline comments
3. Request changes or approve
4. Test locally if needed:
   ```bash
   git fetch origin
   git checkout feature/their-branch
   npm install
   npm run dev
   ```

**As the author:**
1. Address all feedback
2. Respond to comments
3. Push updates
4. Re-request review if needed

---

## 📚 Quick Reference

### Essential Commands

```bash
# Setup
git clone <url>                    # Clone repository
git checkout -b <branch>           # Create and switch to branch

# Making changes
git status                         # Check status
git add .                          # Stage all changes
git commit -m "message"            # Commit changes
git push origin <branch>           # Push to remote

# Syncing
git pull origin main               # Get latest from main
git fetch origin                   # Fetch without merging
git merge origin/main              # Merge main into current branch

# Branching
git branch                         # List branches
git checkout <branch>              # Switch branches
git branch -d <branch>             # Delete local branch
git push origin --delete <branch>  # Delete remote branch

# History
git log                            # View commit history
git diff                           # View changes
git show <commit>                  # Show specific commit

# Undo
git reset --soft HEAD~1            # Undo last commit, keep changes
git reset --hard HEAD~1            # Undo last commit, discard changes
git stash                          # Temporarily save changes
```

---

## 🎓 Learning Resources

- [GitHub Flow Guide](https://guides.github.com/introduction/flow/)
- [Git Documentation](https://git-scm.com/doc)
- [Atlassian Git Tutorials](https://www.atlassian.com/git/tutorials)

---

**Remember**: When in doubt, create a branch and a Pull Request. It's always safer to have your changes reviewed!
