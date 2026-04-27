"""
ai_verifier.py (v2.0 - Multimodal)
-----------------------------------------------------------------
Multimodal AI Verification Script for the TreeApp Project.

Purpose:
- To receive data about a tree's current state, a user's suggested
  update, AND the URL of an image submitted with the update.
- To construct a detailed prompt instructing the AI to act as an expert
  arborist and analyze BOTH the text data and the image.
- To download the image and send it along with the text prompt to the
  Google Gemini Multimodal API.
- To parse the AI's JSON response, which now includes a confidence score.
- To print a clean, standardized JSON object (with decision, justification,
  and confidence) to standard output for the parent Node.js process.
"""
# in utils/ai_verifier.py

import os
import sys
import json
import traceback
import requests
from PIL import Image
import io
import google.generativeai as genai
from dotenv import load_dotenv

LOG_FILE = os.path.join(os.path.dirname(__file__), 'ai_verifier.log')

def _log_error(message: str):
    """Writes a detailed error message and traceback to the log file."""
    with open(LOG_FILE, 'a') as f:
        f.write(f"--- PYTHON SCRIPT ERROR ---\n")
        f.write(f"{message}\n")
        f.write(traceback.format_exc())
        f.write("\n")



def _fetch_images(image_urls: list[str]) -> list[Image.Image]:
    """Downloads all images from a list of URLs and returns them as a list of PIL Image objects."""
    if not image_urls:
        raise ValueError("Image URL list is empty.")
    
    images = []
    for url in image_urls:
        if not url or url == 'null':
            continue # Skip any invalid entries in the list
        
        full_image_url = f"http://localhost:3000{url}"
        try:
            response = requests.get(full_image_url, stream=True)
            response.raise_for_status()
            images.append(Image.open(io.BytesIO(response.content)))
        except requests.exceptions.RequestException as e:
            # Log the error but continue, so one bad image doesn't stop the whole process
            _log_error(f"Failed to download image at {full_image_url}: {e}")
            
    if not images:
        raise ValueError("Could not download any valid images from the provided list.")
        
    return images

def _call_gemini_api(model, suggested_data_json: str, images: list[Image.Image]) -> dict:
    """Constructs a prompt, calls the Gemini API with multiple images, and returns the parsed JSON response."""

    # Construct the multi-modal prompt
    prompt_text = f"""
    You are an expert arborist performing data verification for a tree mapping application...
    {suggested_data_json}
    ...

        INSTRUCTIONS:
        1.  **Analyze the Image:** Carefully examine the tree in the provided image. Look at its leaves, bark, overall shape, and visible health.
        2.  **Verify Species:** Based on the image, is the user's species identification plausible?
        3.  **Verify Condition:** Does the visual health of the tree in the image match the condition described in the data?
        4.  **Make a Decision:** Choose ONE of the following: "Approve", "Reject", or "Flag".
        5.  **Provide a Data-to-Image Confidence Score:** This is the most important step. 
        Provide a numerical score from 0.0 to 1.0 that represents **how well the text data matches the tree in the image**. A score of 1.0 means a perfect match. A score of 0.0 means a complete mismatch (e.g., the image is an oak, the text says it's a pine). **This score must be independent of your final 'decision'.**

        Provide your response as a single, valid JSON object with no other text. The JSON must have three keys:
        - "decision": Your verdict ("Approve", "Reject", or "Flag").
        - "justification": A brief, one-sentence explanation for your decision, referencing the image.
        - "confidence": Your numerical confidence score (e.g., 0.95).

        JSON Response:
        """
    
    # Call the Gemini API with both text and image
    response = model.generate_content([prompt_text, *images])
    
    # Parse and clean response
    json_response_text = response.text.strip().replace('`', '').replace('json', '')
    if not json_response_text:
        raise ValueError("The AI model's text part was empty after cleaning.")

    # Print the JSON to standard text    
    return json.loads(json_response_text)

def run_verification(current_data_json: str, suggested_data_json: str, image_urls_json: str) -> dict:
    """
    Main logic function: orchestrates the fetching, AI call, and error handling.
    This function is designed to be called by both main() and tests.
    """
    try:
        #Load environment and configure API
        load_dotenv()
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found.")
        
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        image_urls = json.loads(image_urls_json) 
        images = _fetch_images(image_urls)    
        parsed_json = _call_gemini_api(model, suggested_data_json, images) 
        
        return parsed_json

    except Exception as e:
        _log_error(str(e))
        return {
            "decision": "Flag",
            "justification": f"AI verification failed due to a script error: {str(e)}",
            "confidence": 0.0
        }

def main():
    """
    Handles command-line arguments and prints the final JSON output.
    This is the entry point when called from Node.js.
    """
    if len(sys.argv) < 4:
        error_response = {
            "decision": "Flag",
            "justification": "AI script called with missing arguments.",
            "confidence": 0.0
        }
        print(json.dumps(error_response))
        sys.exit(1)
        
    current_data_json = sys.argv[1]
    suggested_data_json = sys.argv[2]
    image_urls_json = sys.argv[3] #
    
    result = run_verification(current_data_json, suggested_data_json, image_urls_json)
    print(json.dumps(result))

if __name__ == "__main__":
    main()


