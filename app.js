const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const moment = require('moment');
const path = require('path');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');   


// Function to encrypt data
function encrypt(text) {
    let cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

// Function to decrypt data
function decrypt(text) {
    let parts = text.split(':');
    let iv = Buffer.from(parts.shift(), 'hex');
    let encryptedText = Buffer.from(parts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}



// Setup Express
const app = express();
app.use(bodyParser.json());

// PostgreSQL client configuration with SSL
const clientConfig = {
    user: 'postgres',
    host: 'rds.laughingbull.co.uk',
    database: 'mandir_event_registration',
    password: process.env.DB_PASSWORD,
    port: 5432,
    ssl: {
        rejectUnauthorized: false, // SSL configuration
    },
};

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the upload.html file for the root route (file upload form)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'upload.html')); // Serve the HTML file for uploading
});

// CSV upload endpoint
app.post('/upload', multer({ dest: 'uploads/' }).single('file'), (req, res) => {
    const results = [];

    // Read the CSV file line by line and add each row to the results array
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => results.push(row))
        .on('end', async () => {
            const client = new Client(clientConfig);
            try {
                await client.connect();

                // Process each row sequentially (one by one)
                for (const row of results) {
                    await processRow(row, client);  // Wait for each row to be processed
                }

                res.json({ message: 'CSV file uploaded and data inserted into the database successfully!' });
            } catch (error) {
                console.error('Error inserting data:', error);
                res.status(500).json({ message: 'Error inserting data into the database.' });
            } finally {
                await client.end();
                fs.unlinkSync(req.file.path); // Delete the uploaded CSV file
            }
        });
});

// Function to process and insert each row into the database
async function processRow(row, client) {
    try {
        const timestampValue = row['Timestamp'];
        let convertedTimestamp = null;

        // Validate the timestamp and handle invalid dates
        if (moment(timestampValue, 'DD/MM/YYYY HH:mm:ss', true).isValid()) {
            convertedTimestamp = moment(timestampValue, 'DD/MM/YYYY HH:mm:ss').format('YYYY-MM-DD HH:mm:ss');
        } else {
            console.warn(`Invalid date format for row: ${JSON.stringify(row)}`);
            convertedTimestamp = null; // Insert NULL if the date is invalid
        }

        // Insert into event_participation table
        const result = await client.query(
            `INSERT INTO event_participation 
            (email_address, first_name, last_name, mobile_number, number_of_tickets, car_parking, torch_burn_ravan_effigy, samosa, dabeli, vada_idli_combo, jalebi, car_registration_number, payable_total, payable_status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id`,
            [
                row['Email address'],                         // Email
                row['First Name'],                            // First Name
                row['Last Name'],                             // Last Name
                row['Mobile Number'],                         // Mobile Number
                row['Number of Tickets'],                     // Number of Tickets
                row['Car Parking'],                           // Car Parking
                row['Torch/Burn Ravan Effigy'],               // Torch/Burn Ravan
                row['Samosa'],                                // Samosa
                row['Dabeli'],                                // Dabeli
                row['Vada-Idli Combo'],                       // Vada-Idli Combo
                row['Jalebi'],                                // Jalebi
                row['Car Registration Number'],               // Car Registration
                row['Payable Total'],                         // Payable Total
                row['Payable Status']                         // Payable Status
            ]
        );

        const eventParticipationId = result.rows[0].id;  // Get the inserted row's ID

        // Insert into validation_status table
        await client.query(
            `INSERT INTO validation_status (event_participation_id, entry_validated, food_collected, parking_validated) 
            VALUES ($1, $2, $3, $4)`,
            [eventParticipationId, false, false, false]  // Default validation status to false
        );

        // Log each row in the console
        console.log(`Processed row: ${JSON.stringify(row)}`);

    } catch (error) {
        console.error(`Error inserting row: ${JSON.stringify(row)}`, error);
        throw error; // Ensure the error is caught and handled at the higher level
    }
}


app.get('/view-data', async (req, res) => {
    const client = new Client(clientConfig);
    try {
        await client.connect();

        // Fetch all data from event_participation and qr_codes, ordered by id
        const result = await client.query(`
            SELECT ep.*, qc.qr_code_url, qc.qr_email_sent
            FROM event_participation ep
            LEFT JOIN qr_codes qc ON ep.id = qc.event_participation_id
            ORDER BY ep.id ASC
        `);

        const eventData = result.rows;

        // Render the view-data template with the fetched data
        res.render('view-data', { data: eventData });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data from the database.');
    } finally {
        await client.end();
    }
});


// Decrypt QR code data when accessed
app.get('/scan-qr/:encryptedData', (req, res) => {
    const { encryptedData } = req.params;

    try {
        const decryptedData = decrypt(encryptedData);
        res.json({ message: 'QR code decrypted successfully', data: decryptedData });
    } catch (error) {
        console.error('Error decrypting QR code:', error);
        res.status(500).json({ message: 'Error decrypting QR code' });
    }
});



app.get('/scan/:id', async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Fetch the participant's details, including food items and validation status
        const result = await client.query(`
            SELECT ep.*, vs.entry_validated, vs.food_collected, vs.parking_validated
            FROM event_participation ep
            LEFT JOIN validation_status vs ON ep.id = vs.event_participation_id
            WHERE ep.id = $1
        `, [id]);

        const eventData = result.rows[0];

        if (eventData) {
            // Parse the number of items from the food item columns
            eventData.samosa_count = parseFoodQuantity(eventData.samosa);
            eventData.dabeli_count = parseFoodQuantity(eventData.dabeli);
            eventData.vada_idli_combo_count = parseFoodQuantity(eventData.vada_idli_combo);
            eventData.jalebi_count = parseFoodQuantity(eventData.jalebi);

            // Render the scan-result template with the parsed data
            res.render('scan-result', { data: eventData });
        } else {
            res.status(404).send('No data found for this QR code.');
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data from the database.');
    } finally {
        await client.end();
    }
});

// Function to parse the quantity of food items from the string (e.g., "2 - £3")
function parseFoodQuantity(foodString) {
    if (!foodString) return 0; // If the string is null or undefined
    const quantity = foodString.split(' - £')[0]; // Extract the part before " - £"
    return parseInt(quantity, 10) || 0; // Convert to an integer or return 0 if not a number
}


// Function to parse the quantity of food items from the string (e.g., "2 - £3")
function parseFoodQuantity(foodString) {
    if (!foodString) return 0; // If the string is null or undefined
    const quantity = foodString.split(' - £')[0]; // Extract the part before " - £"
    return parseInt(quantity, 10) || 0; // Convert to an integer or return 0 if not a number
}





// Route to update parking status
app.post('/update/parking/:id', async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();
        // Update parking status to TRUE
        await client.query('UPDATE event_participation SET parking_status = TRUE WHERE id = $1', [id]);
        res.json({ message: 'Parking status updated successfully!' });
    } catch (error) {
        console.error('Error updating parking status:', error);
        res.status(500).json({ message: 'Error updating parking status.' });
    } finally {
        await client.end();
    }
});

app.post('/update/food/:id', async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Update the food_collected status in the validation_status table
        await client.query(
            `UPDATE validation_status SET food_collected = TRUE WHERE event_participation_id = $1`,
            [id]
        );

        res.json({ message: 'Food collection validated successfully!' });
    } catch (error) {
        console.error('Error updating food collection validation:', error);
        res.status(500).json({ message: 'Error validating food collection' });
    } finally {
        await client.end();
    }
});


app.post('/update/entry/:id', async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Update the entry_validated status in the validation_status table
        await client.query(
            `UPDATE validation_status SET entry_validated = TRUE WHERE event_participation_id = $1`,
            [id]
        );

        res.json({ message: 'Entry validated successfully!' });
    } catch (error) {
        console.error('Error updating entry validation:', error);
        res.status(500).json({ message: 'Error validating entry' });
    } finally {
        await client.end();
    }
});

// Route to generate and store a QR code for a participant
app.post('/generate-qr/:id', async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Check if the QR code has already been generated
        const existingQRCode = await client.query(
            'SELECT * FROM qr_codes WHERE event_participation_id = $1',
            [id]
        );

        if (existingQRCode.rows.length > 0) {
            return res.json({ message: 'QR code already exists' });
        }

        // Generate the QR code URL
        const qrUrl = `http://localhost:3000/scan/${id}`;
        const qrCodeData = await qrcode.toDataURL(qrUrl);

        // Insert the QR code into the qr_codes table
        await client.query(
            `INSERT INTO qr_codes (event_participation_id, qr_code_url) 
            VALUES ($1, $2)`,
            [id, qrCodeData]
        );

        res.json({ message: 'QR code generated successfully' });
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ message: 'Error generating QR code.' });
    } finally {
        await client.end();
    }
});



// Setup nodemailer transporter (using a dummy example for Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,  // Your email address (e.g., Gmail)
        pass: process.env.EMAIL_PASSWORD // Your email password
    }
});

app.post('/email-qr/:id', async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Fetch the participant's email and QR code URL
        const result = await client.query(`
            SELECT ep.email_address, qc.qr_code_url
            FROM event_participation ep
            LEFT JOIN qr_codes qc ON ep.id = qc.event_participation_id
            WHERE ep.id = $1
        `, [id]);

        const participant = result.rows[0];

        if (!participant || !participant.qr_code_url) {
            return res.status(404).json({ message: 'QR code not found for this participant' });
        }

        // Send email with the QR code
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: participant.email_address,
            subject: 'Your Event QR Code',
            html: `
                <p>Hello,</p>
                <p>Here is your event QR code:</p>
                <img src="${participant.qr_code_url}" alt="QR Code">
            `
        };

        transporter.sendMail(mailOptions, async (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                return res.status(500).json({ message: 'Error sending email' });
            } else {
                // Mark the QR code email as sent in the database
                await client.query(
                    `UPDATE qr_codes SET qr_email_sent = TRUE WHERE event_participation_id = $1`,
                    [id]
                );

                res.json({ message: 'QR code emailed successfully' });
            }
        });

    } catch (error) {
        console.error('Error emailing QR code:', error);
        res.status(500).json({ message: 'Error emailing QR code' });
    } finally {
        await client.end();
    }
});



// Setup template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Start the server
app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
