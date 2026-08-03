# SSC Prep Hub — Master Build Prompt v1 (Core Platform Architecture)

> Original base spec (2026-08-03). This is the full v1. v2 (`ssc-prep-hub-hermes-prompt-v2.md`) rewrites §7 and adds §§15–20; v3 (`ssc-prep-hub-hermes-prompt-v3.md`) amends pricing and adds personalization/bilingual/PYQ features. Read all three together, or use `SSC-PREP-HUB-MASTER-PLAN.md`.

---

You are a Senior Full Stack Engineer, UI/UX Designer, System Architect, Database Architect, Security Engineer, Mobile App Developer, DevOps Engineer, AI Engineer, Performance Optimization Expert and Product Designer.

Your task is to build a production-ready SSC exam preparation platform similar to Testbook, Oliveboard, Adda247, PracticeMock and ixamBee but with a more modern UI, faster performance, better analytics and cleaner architecture.

=====================================================

PROJECT NAME

=====================================================

SSC Prep Hub

Domain:
sscprephub.in

Tagline:

India's Most Advanced SSC Practice Platform

=====================================================

GOAL

=====================================================

Create a Premium SSC Preparation Website + Mobile App.

The platform must be capable of handling lakhs of users.

No placeholder code.

No dummy pages.

Everything should be production ready.

Use best coding standards.

Zero bugs.

No shortcuts.

Follow scalable architecture.

=====================================================

TECH STACK

=====================================================

Frontend

Next.js Latest

React Latest

TypeScript

Tailwind CSS

Shadcn UI

Framer Motion

React Query

Redux Toolkit

PWA Support

Backend

Node.js

NestJS

PostgreSQL

Prisma ORM

Redis

BullMQ Queue

Authentication

JWT

Refresh Token

Email OTP Login

Google Login

Password Reset

Email Verification

Admin RBAC

Payment

Razorpay

Webhook Verification

Invoice Generation

Subscription Management

Storage

AWS S3

Cloudflare CDN

Database

PostgreSQL

Search

Meilisearch

Analytics

Custom Analytics

Google Analytics

Microsoft Clarity

Realtime

Socket.io

Deployment

Docker

Nginx

GitHub Actions

CI/CD

=====================================================

MOBILE APP

=====================================================

Build Flutter App

Android

iOS

Tablet

Desktop

Web

Everything must sync.

=====================================================

THEME

=====================================================

Modern

Premium

Minimal

Fast

Dark Mode

Light Mode

System Theme

Smooth animations

=====================================================

AUTHENTICATION

=====================================================

Email Login

Email Signup

OTP Verification

Forgot Password

Remember Login

Single Device Login

If user logs in on Web

Logout from previous Web Session

If logs in App

Previous App logout

Maximum

1 Web Session

1 App Session

Admin can see active devices

Device History

IP Address

Browser

Location

=====================================================

ADMIN ACCOUNT

=====================================================

Admin account must be configurable securely through environment variables or the admin dashboard (do not hardcode credentials).

Admin features:

Dashboard

Revenue

Today's Revenue

Monthly Revenue

Yearly Revenue

Subscriptions

Expired Users

Active Users

Inactive Users

Daily Logins

Tests Attempted Today

Total Questions Solved

Average Score

Payment History

Coupons

Notifications

Emails

PDF Upload

Question Approval

Question Editing

Analytics

=====================================================

SUBSCRIPTIONS

=====================================================

Monthly

₹19

24 Months

₹199

Admin can

Pause Subscription

Refund

Cancel

Gift Subscription

Coupon Codes

Referral

=====================================================

PAYMENT

=====================================================

Razorpay Integration

Webhook

Invoice PDF

GST Ready

Success Page

Failure Page

Retry Payment

=====================================================

QUESTION BANK

=====================================================

The platform must NOT hardcode questions.

Instead

Ask Admin to upload PDFs.

The system must have an Upload PDF Wizard.

When PDF is uploaded

AI should extract:

Subject

Chapter

Topic

Sub Topic

Question

Options

Correct Answer

Explanation

Difficulty

Language

Exam Name

Year

Shift

Paper Code

Marks

Negative Marks

Question Type

Tags

Images

Tables

Math Equations

Hindi Text

English Text

OCR

Formatting

Everything automatically.

=====================================================

SUPPORTED SUBJECTS

=====================================================

Reasoning

English

General Awareness

Quantitative Aptitude

Computer

Current Affairs

Static GK

=====================================================

SUPPORTED EXAMS

=====================================================

SSC CGL

SSC CHSL

SSC CPO

SSC MTS

SSC GD

SSC JE

SSC Stenographer

SSC Selection Post

Delhi Police

CISF

CRPF

BSF

CAPF

Other SSC Exams

=====================================================

FILTERS

=====================================================

Questions by

Subject

Chapter

Topic

Sub Topic

Exam

Year

Shift

Difficulty

Attempted

Unattempted

Correct

Incorrect

Bookmarked

Language

=====================================================

PYQ FEATURES

=====================================================

Every question should display:

Exam Name

Year

Shift

Paper

Subject

Chapter

Topic

Marks

Negative Marks

Difficulty

Source PDF

Explanation

Related Questions

Bookmark

Notes

=====================================================

TEST TYPES

=====================================================

Chapter Test

Topic Test

Subject Test

Mini Mock

Full Mock

Previous Year Paper

Shift Wise Paper

Year Wise Paper

Custom Test

Weak Topic Test

Speed Test

Revision Test

Random Test

=====================================================

REAL SSC TEST EXPERIENCE

=====================================================

Exactly like SSC Exam

Question Palette

Visited

Answered

Marked

Marked for Review

Time Left

Question Navigation

Calculator

Instructions

Submit Confirmation

Auto Submit

=====================================================

TEST TIMER

=====================================================

Pause Prevention

Tab Switch Warning

Fullscreen Mode

Auto Save

Network Recovery

=====================================================

RESULT PAGE

=====================================================

Instant Result

Rank

Percentile

Score

Attempted

Correct

Wrong

Skipped

Negative Marks

Accuracy

Speed

Average Time

Question Review

=====================================================

ADVANCED ANALYTICS

=====================================================

AI should analyse

Weak Subject

Weak Topic

Weak Chapter

Strong Areas

Revision Suggestions

Daily Targets

Study Plan

Estimated SSC Score

Probability of Selection

Topic Heatmap

Progress Graph

Accuracy Graph

Attempt Trend

=====================================================

ANSWER REVIEW

=====================================================

Each Question

Correct Answer

Your Answer

Explanation

Video Link

Source

PDF Page Number

Bookmark

Report Error

=====================================================

DOWNLOAD FEATURES

=====================================================

Answer Key PDF

Question Paper PDF

Attempt Report PDF

Performance Report PDF

Certificate PDF

=====================================================

SEARCH

=====================================================

Global Search

Search Question

Search Topic

Search Year

Search Shift

Search Paper

=====================================================

DASHBOARD

=====================================================

Today's Progress

Weekly Progress

Monthly Progress

Study Streak

Daily Goal

Achievements

Leaderboard

=====================================================

BOOKMARKS

=====================================================

Favourite Questions

Favourite Tests

Favourite Topics

=====================================================

NOTES

=====================================================

Student Notes

Highlight

Personal Comments

=====================================================

NOTIFICATIONS

=====================================================

Push Notifications

Email Notifications

Payment Reminder

Test Reminder

=====================================================

BLOG

=====================================================

SSC News

Result Updates

Vacancies

Answer Keys

Preparation Tips

=====================================================

SEO

=====================================================

Complete SEO

Schema

Sitemap

Robots

Fast Loading

Core Web Vitals

=====================================================

SECURITY

=====================================================

Rate Limiting

Helmet

XSS Protection

CSRF

SQL Injection Prevention

Encryption

Audit Logs

=====================================================

PERFORMANCE

=====================================================

Lazy Loading

Image Optimization

Caching

Redis

CDN

Compression

=====================================================

ADMIN PDF IMPORT

=====================================================

The admin must upload SSC PDFs.

The system should automatically ask for:

Subject

Book Name

Publisher

Language

Exam

Year

Shift

Then import all questions.

No manual typing.

=====================================================

IMPORTANT

=====================================================

The website must ask the admin to upload PDF files because the entire question bank will come from uploaded PDFs.

Do not hardcode SSC questions.

Instead create an AI-powered PDF parser that converts uploaded PDFs into a structured database.

=====================================================

EXTRA PREMIUM FEATURES

=====================================================

AI Doubt Solver

Voice Search

Text to Speech

Dark Mode

Light Mode

Offline App

PWA

Daily Challenge

Study Calendar

Leaderboard

Referral

Achievements

Badges

Coins

XP

Daily Login Rewards

Revision Planner

Bookmarks

Question Discussion

Report Error

Announcements

Exam Calendar

Vacancy Tracker

Current Affairs

PDF Reader

Revision Mode

Wrong Question Notebook

Adaptive AI Mock Test

Smart Recommendations

Weak Topic Booster

Live Test

All India Rank

Realtime Leaderboard

Multi Language

Hindi

English

Admin CMS

Support Ticket

Feedback

Coupon System

Affiliate System

Email Templates

Backup System

Restore System

Export Database

Import Database

=====================================================

FINAL GOAL

=====================================================

Build the best SSC Exam Preparation Platform in India with zero bugs, premium UI, scalable backend, AI-powered PDF import, advanced analytics, secure payment system, responsive website, Flutter mobile app, and production-ready deployment.
