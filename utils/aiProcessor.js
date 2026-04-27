const path = require('path');
const { PythonShell } = require('python-shell');
const db = require('../config/db');
const { createNotification } = require('./notifications');

// Confidence thresholds for automated actions
const CONFIDENCE_THRESHOLD_APPROVE = 0.9;
const CONFIDENCE_THRESHOLD_FLAG = 0.7;

async function processAIVerification(updateId) {
    console.log(`Starting MULTIMODAL AI verification for update ID: ${updateId}`);
    const connection = await db.promise().getConnection();
    let updateData;

    try {
        await connection.beginTransaction();

        // Gather update data
        [[updateData]] = await connection.query("SELECT * FROM tree_updates WHERE update_id = ? AND status = 'pending' FOR UPDATE", [updateId]);

        
        // Skips process if there's no pending update
        if (!updateData) {
            console.log(`Skipping AI verification for update ID: ${updateId}. Not pending.`);
            await connection.commit();
            return;
        }

        // Fetch all images associated with this update
        const [imageRows] = await connection.query("SELECT image_url FROM image_metadata WHERE update_id = ?", [updateId]);

        // If there are no images, AI can't be used. Skip process.
        if (imageRows.length === 0) {
            await connection.query(
                `UPDATE tree_updates SET status = 'pending', ai_decision = 'Flag', ai_justification = 'AI review skipped: No image was submitted with this update.', processed_by = 'system' WHERE update_id = ?`,
                [updateId]
            );
            await connection.commit();
            console.log(`AI verification for update ID: ${updateId} skipped. No images found.`);
            return;
        }

        // Create an array of all the image URLs
        const imageUrls = imageRows.map(row => row.image_url);
        
        // Get current tree data and format the suggested update data
        const [[currentTreeData]] = await connection.query('SELECT * FROM trees WHERE tree_id = ?', [updateData.tree_id]);
        const suggestedUpdateData = {
            species_id: updateData.species_id,
            age_id: updateData.age_id,
            condition_id: updateData.condition_id,
            notes: updateData.notes,

            // Include expert data if submitted
            diameter_cm: updateData.diameter_cm,
            spread_radius_m: updateData.spread_radius_m,
            tree_height_m: updateData.tree_height_m,
        };

        // Define paths to Python env, script, and serialise data to JSON strings
        const options = {
            mode: 'text',
            pythonPath: path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe'),
            scriptPath: path.join(__dirname),
            args: [JSON.stringify(currentTreeData), JSON.stringify(suggestedUpdateData), JSON.stringify(imageUrls)]
        };

        const [aiResultJson] = await PythonShell.run('ai_verifier.py', options);
        const aiDecision = JSON.parse(aiResultJson);
        const confidence = parseFloat(aiDecision.confidence) || 0.0;

        const finalStatus = aiDecision.decision.toLowerCase().startsWith('approve') ? 'approved' : aiDecision.decision.toLowerCase();
        
        if (finalStatus === 'approved') {
            
            // Update the main tree record with the suggested data
            const fieldsToUpdate = {};
            if (updateData.species_id) fieldsToUpdate.species_id = updateData.species_id;
            if (updateData.age_id) fieldsToUpdate.age_id = updateData.age_id;
            if (updateData.condition_id) fieldsToUpdate.condition_id = updateData.condition_id;
            if (updateData.notes) fieldsToUpdate.notes = updateData.notes;
            if (updateData.diameter_cm) fieldsToUpdate.diameter_cm = updateData.diameter_cm;
            if (updateData.spread_radius_m) fieldsToUpdate.spread_radius_m = updateData.spread_radius_m;
            if (updateData.tree_height_m) fieldsToUpdate.tree_height_m = updateData.tree_height_m;
            if (updateData.surround_id) fieldsToUpdate.surround_id = updateData.surround_id;
            
            // Add the timestamp automatically
            fieldsToUpdate.updated_at = new Date();

            // Only run the query if there's something to update
            if (Object.keys(fieldsToUpdate).length > 0) {
                await connection.query(
                    'UPDATE trees SET ? WHERE tree_id = ?',
                    [fieldsToUpdate, updateData.tree_id]
                );
            }
            
            // If the update is approved within the confidence threshold the tree is verified
            if (confidence >= CONFIDENCE_THRESHOLD_APPROVE) {
                await connection.query('UPDATE trees SET is_verified = 1 WHERE tree_id = ?', [updateData.tree_id]);
                console.log(`Tree #${updateData.tree_id} has been automatically verified by the AI.`);
            }

            // If confidence is good but not great, flag the tree for human review
            if (confidence < CONFIDENCE_THRESHOLD_APPROVE && confidence >= CONFIDENCE_THRESHOLD_FLAG) {
                await connection.query(`UPDATE trees SET flag_type = 'ai_review' WHERE tree_id = ?`, [updateData.tree_id]);
            }
        }
        
        //  Save the new confidence score to the database 
        await connection.query(
            `UPDATE tree_updates SET status = ?, ai_decision = ?, ai_justification = ?, ai_confidence = ?, processed_by = 'ai' WHERE update_id = ?`,
            [finalStatus, aiDecision.decision, aiDecision.justification, confidence, updateId]
        );

        await connection.commit();

        // Create notification
        let notificationMessage = `Your suggestion for Tree #${updateData.tree_id} was reviewed by our AI. Decision: ${aiDecision.decision} (Confidence: ${confidence.toFixed(2)}).`;
        await createNotification({
            user_id: updateData.user_id,
            tree_id: updateData.tree_id,
            message: notificationMessage,
            type: `update_${finalStatus}`,
            db: db
        });

        console.log(`Multimodal AI verification for update ID: ${updateId} completed. Decision: ${aiDecision.decision}, Confidence: ${confidence}`);

    } catch (err) {
        if (connection) await connection.rollback();
        console.error(`AI verification for update ID: ${updateId} failed:`, err);
        //  Error notification logic 
    } finally {
        if (connection) connection.release();
    }
}

module.exports = { processAIVerification };