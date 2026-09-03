# Security and Data Safety Policy

## 1. Project scope

This repository contains an offline prototype and design assets for organization-level people efficiency analytics. It is not a production HR, payroll, forecasting, or identity system.

## 2. Never commit sensitive data

Do **not** commit any of the following to GitHub:

- Personal identity data: names, employee IDs, phone numbers, email addresses, addresses, ID numbers;
- Individual compensation, bonus, performance, potential, succession, medical, or disciplinary information;
- Real customer, contract, order, project, financial-detail, or payroll-detail data;
- Credentials: passwords, API keys, OAuth tokens, SSH private keys, database connection strings;
- Internal hostnames, VPN addresses, production URLs, or confidential architecture documents.

## 3. Recommended repository visibility

- Use a **Private** repository during product design, internal review, or when there is any uncertainty about data ownership;
- Switch to **Public** only after the project Owner confirms that every committed file is non-sensitive and suitable for public release;
- The standard template and sample report in this repository must remain simulated or fully anonymized.

## 4. Prototype data behavior

The V6.3 prototype parses selected Excel files in the local browser. It does not intentionally upload files or make external network requests. This does not replace formal enterprise security review.

## 5. Report a concern

If you find sensitive content or a security issue, do not create a public Issue with confidential details. Contact the repository owner privately and remove / rotate affected content as soon as possible.
