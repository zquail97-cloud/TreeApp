A Multimodal AI-Powered Urban Tree Inventory

TreeApp is a full-stack web application for crowdsourcing, visualising, and verifying urban tree data in Belfast.  
Its core innovation is a **hybrid human–AI verification pipeline** designed to ensure the quality and integrity of citizen-generated data.

---

## Project Vision

Urban tree management is often hampered by incomplete legacy datasets and unreliable crowdsourced data. **TreeApp** addresses these challenges by:

- Enabling the public to contribute tree health data through a mobile-first interface.
- Empowering administrators with tools for verification, moderation, and reporting.
- Combining **community consensus** with **multimodal AI analysis** to ensure reliable, management-grade environmental data.

---

## Key Features

### For Public Users
- **Interactive Map** – Leaflet.js-powered map of verified and pending trees.  
- **Real-Time Geolocation** – Sync your location to view nearby trees.  
- **Tree Submission** – Submit new tree observations with species, age, condition, and photos.  
- **Expert Mode** – Unlock detailed forestry fields (diameter, height, canopy spread).  
- **Suggest Updates & Vote** – Propose changes to existing records and up/downvote pending updates.  
- **User Portal** – Track submissions, view notifications, and manage account settings.  

### For Administrators
- **Secure Dashboard** – Desktop-oriented management interface.  
- **Tree Management Portal** – CRUD (Create, Read, Update, Delete) with filtering, sorting, and pagination.  
- **Update Verification Workflow** – Review AI confidence scores, community votes, and approve/reject updates.  
-  **AI Pipeline Trigger** – Manually run AI verification for pending updates.  
- **Bulk Data Management** – Upload records via CSV.  
- **Reporting & Analytics** – Generate summary statistics and download CSV reports.  

---

## System Architecture

TreeApp uses a **three-tier architecture**:

- **Presentation (Client)** – EJS, HTML, CSS, and client-side JavaScript.  
- **Logic (Server)** – Node.js + Express.js RESTful API handling business logic and authentication.  
- **Data (Database)** – MySQL relational schema with strict data integrity.  
 
**Innovation**: A polyglot backend – Node.js communicates with a Python AI module via `python-shell`, allowing integration with the **Google Gemini API** for multimodal verification.

---


## Getting Started

### Prerequisites
- [Node.js] v18.x or later  
- [Python] v3.10 or later  
- MySQL server (v8.x)  
- API key for (https://ai.google.dev/)  

---

### Installation & Setup

1. **Clone the Repository**
   bash
   git clone https://gitlab.eeecs.qub.ac.uk/40181730/40181730-treeapp.git
   cd TreeApp

2. **Install Node.js Dependencies**
	npm install

3. **Set Up the Database**
	Create a new database (e.g., treeapp_db).
	Import belfast_trees_db.sql into your database.
	Seed lookup tables (species, age, condition...)

4. ** Setup Python Environment**
	# Create virtual environment
	python -m venv .venv

	# Activate venv
	.\.venv\Scripts\activate   # Windows
	source .venv/bin/activate  # macOS/Linux

	# Install dependencies
	pip install google-generativeai python-dotenv Pillow requests
	pip freeze > requirements.txt

5. ** Configure Environment Variables **
	PORT=3000
	DB_HOST=localhost
	DB_USER=root
	DB_PW=
	DB_NAME=belfast_trees_db
	DB_PORT=3306
	GEMINI_API_KEY=(Can be generated for free in Google Gemini Studio)

6. ** Run the Application*
	node app.js

7. ** Running Tests**
	npm test
	    &
	 pytest

## Login Credentials

Standard User: zquail01@qub.ac.uk
	 Pass: Trees123

   Admin User: admin@treeapp.local
	 Pass: admin123

Project Structure

/
|-- config/         # DB + environment configs
|-- controllers/    # Route logic
|-- middleware/     # Express middleware (auth, RBAC)
|-- public/         # Static assets (CSS, JS, images)
|-- routes/         # API + page routes (api.js, admin.js)
|-- utils/          # Helpers + AI scripts (aiProcessor.js, ai_verifier.py)
|-- views/          # EJS templates
|-- __tests__/      # Jest tests for Node.js backend
|-- tests/          # Pytest tests for AI scripts
|-- app.js          # Express app entry point
|-- package.json    # Node.js dependencies


This project was developed as part of an MSc dissertation at Queen’s University Belfast.
For academic use only.