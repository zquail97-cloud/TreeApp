# in tests/test_ai_verifier.py

import pytest
from unittest.mock import patch
import json
from PIL import Image
import io

# Import the script to be tested
# Gets ai_verifier.py from /utils
from utils import ai_verifier

# --- Test Suite for AI Verifier Script ---

@patch('utils.ai_verifier._call_gemini_api')
@patch('utils.ai_verifier._fetch_image')
def test_successful_approval(mock_fetch_image, mock_call_gemini):
    """
    Tests the "happy path" where both image download and the AI call succeed.
    """
    # Configure the Mocks
    # Simulate a successful image download. The content doesn't matter.
    mock_fetch_image.return_value = Image.new('RGB', (10, 10))
    
    # Simulate a successful Gemini API response.
    mock_call_gemini.return_value = {
        "decision": "Approve",
        "justification": "Looks good.",
        "confidence": 0.98
    }

    # Call the function to be tested
    result = ai_verifier.run_verification("{}", "{}", "/fake.jpg")

    # Assert the results
    assert result['decision'] == 'Approve'
    assert result['confidence'] == 0.98
    
    # Verify that mocked functions were actually called
    mock_fetch_image.assert_called_once_with("/fake.jpg")
    mock_call_gemini.assert_called_once()


@patch('utils.ai_verifier._call_gemini_api')
@patch('utils.ai_verifier._fetch_image')
def test_image_download_failure(mock_fetch_image, mock_call_gemini):
    """
    Tests that the script returns a 'Flag' decision if the image download fails.
    """
    # Simulate a failed image download by raising an exception
    mock_fetch_image.side_effect = Exception("Network timeout")

    # Call the function with mock data
    result = ai_verifier.run_verification("{}", "{}", "/bad_url.jpg")
    
    # Assert that the script handled the error gracefully
    assert result['decision'] == 'Flag'
    assert result['confidence'] == 0.0
    assert "Network timeout" in result['justification']
    
    # Verify that the Gemini API was not called due to failure
    mock_call_gemini.assert_not_called()


@patch('utils.ai_verifier._call_gemini_api')
@patch('utils.ai_verifier._fetch_image')
def test_gemini_api_failure(mock_fetch_image, mock_call_gemini):
    """
    Tests that the script returns a 'Flag' decision if the Gemini API call fails.
    """
    # Configure the Mocks
    mock_fetch_image.return_value = Image.new('RGB', (10, 10))
    # Simulate a failed API call
    mock_call_gemini.side_effect = Exception("API key invalid")

    #  Call the function
    result = ai_verifier.run_verification("{}", "{}", "/good_url.jpg")

    #  Assert the results
    assert result['decision'] == 'Flag'
    assert result['confidence'] == 0.0
    assert "API key invalid" in result['justification']