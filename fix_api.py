import re
import os

def fix_file(filepath):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Define the patterns we want to replace
    patterns = [
        ('process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"', 'API_BASE'),
        ("process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'", 'API_BASE'),
        ('${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1"}', '${API_BASE}'),
        ("${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'}", '${API_BASE}'),
    ]
    
    new_content = content
    total_replaced = 0
    for old, new in patterns:
        # Count occurrences
        count = new_content.count(old)
        if count > 0:
            new_content = new_content.replace(old, new)
            total_replaced += count
    
    if total_replaced > 0:
        # Ensure we have the import
        if 'import { API_BASE } from "@/lib/api";' not in new_content:
            lines = new_content.split('\n')
            # Find the last import or 'use client' line to insert after
            insert_at = 0
            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped.startswith('import ') or stripped == '"use client";':
                    insert_at = i + 1
            lines.insert(insert_at, 'import { API_BASE } from "@/lib/api";')
            new_content = '\n'.join(lines)
        
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Fixed {filepath}: replaced {total_replaced} occurrence(s)")
    else:
        print(f"No pattern found in {filepath}")

if __name__ == '__main__':
    # List of files to fix (from the grep output, excluding backups)
    files_to_fix = [
        "frontend/src/app/bookmarks/page.tsx",
        "frontend/src/app/cgl-test/instructions-data.ts",
        "frontend/src/app/cgl-test/page.tsx",
        "frontend/src/app/dashboard/page.tsx",
        "frontend/src/app/discover/page.tsx",
        "frontend/src/app/leaderboard/page.tsx",
        "frontend/src/app/mocks/page.tsx",
        "frontend/src/app/pricing/page.tsx",
        "frontend/src/app/question-bank-practice/page.tsx",
        "frontend/src/app/question-bank/page.tsx",
        "frontend/src/app/quiz/page.tsx",
        "frontend/src/app/referral/page.tsx",
        "frontend/src/app/results/[attemptId]/page.tsx",
        "frontend/src/app/results/page.tsx",
        "frontend/src/app/review/page.tsx",
        "frontend/src/app/sectional/page.tsx",
        "frontend/src/app/study-plan/page.tsx",
        "frontend/src/app/test/page.tsx",
        "frontend/src/app/verification/page.tsx",
        "frontend/src/app/weak-practice/page.tsx",
        "frontend/src/app/weak-topics/page.tsx",
        "frontend/src/lib/api-base.ts",
        "frontend/src/lib/api.ts",
    ]
    
    for filepath in files_to_fix:
        fix_file(filepath)
