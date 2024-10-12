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
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

// Setup Express
const app = express();
app.use(bodyParser.json());
app.use('/scripts', express.static(path.join(__dirname, 'node_modules/html5-qrcode')));


// Session middleware
app.use(session({
    secret: process.env.SECRET_KEY || 'SuperSecretKey',  // Use a strong secret in production
    resave: false,
    saveUninitialized: true,
}));

// Flash message middleware
app.use(flash());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());


// Middleware to make flash messages available in templates
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    next();
});

// Dummy user database for authentication
const users = [
    { username: 'admin', password: '$2b$10$9BEoGEtoF1H3r.YHDQzYxOq8nTCBbopmBApj5Fpxdja9T3XEyQPKa' },  // Admin stays the same
    { username: 'user1', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user2', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user3', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user4', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user5', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user6', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user7', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user8', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user9', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' },
    { username: 'user10', password: '$2b$12$GpN0dLlsu4hylb9FzHnIMueu2M.YsrfRhcv8gBUHpw0q2nIw79B1y' }
];

// Function to find user by username
const findUserByUsername = (username) => users.find(user => user.username === username);

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

// Middleware to protect routes
function ensureAuthenticated(req, res, next) {
    if (req.session.user) {
        console.log("User is authenticated, proceeding to requested route");  // Debugging
        return next();  // User is authenticated
    } else {
        console.log("User not authenticated, redirecting to sign-in");  // Debugging
        req.flash('error_msg', 'Please sign in to access this page.');
        return res.redirect('/signin');
    }
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Setup template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Root route redirects to either main page or sign-in page
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/main');  // If authenticated, go to main page
    } else {
        res.redirect('/signin');  // Redirect to sign-in page if not authenticated
    }
});

// Sign-in page route
app.get('/signin', (req, res) => {
    res.render('signin');
});

app.post('/signin', [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        req.flash('error_msg', errors.array().map(err => err.msg));
        return res.redirect('/signin');
    }

    const { username, password } = req.body;
    const user = findUserByUsername(username);

    if (!user) {
        req.flash('error_msg', 'Invalid username or password');
        return res.redirect('/signin');
    }

    // Compare password with hashed password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        req.flash('error_msg', 'Invalid username or password');
        return res.redirect('/signin');
    }

    req.session.user = user;  // Set user in session
    req.flash('success_msg', 'You are now signed in');
    return res.redirect('/main');  // Redirect to the main page after login
});



// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid');
    res.redirect('/signin');
});

// GET route to render the upload form
app.get('/upload', ensureAuthenticated, (req, res) => {
    res.render('upload');  // This will render an upload.ejs form
});


// Main page route (protected)
app.get('/main', ensureAuthenticated, (req, res) => {
    res.render('main');
});

// POST route to handle CSV upload
app.post('/upload', ensureAuthenticated, multer({ dest: 'uploads/' }).single('file'), (req, res) => {
    const results = [];

    // Check if file is uploaded
    if (!req.file) {
        req.flash('error_msg', 'Please upload a file');
        return res.redirect('/upload');
    }

    // Read and process the CSV file
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => results.push(row))
        .on('end', async () => {
            const client = new Client(clientConfig);
            try {
                await client.connect();

                for (const row of results) {
                    await processRow(row, client);  // Process each row
                }

                req.flash('success_msg', 'CSV file uploaded and data inserted successfully!');
                res.redirect('/upload');
            } catch (error) {
                console.error('Error inserting data:', error);
                req.flash('error_msg', 'Error inserting data into the database.');
                res.redirect('/upload');
            } finally {
                await client.end();
                fs.unlinkSync(req.file.path);  // Delete the uploaded file
            }
        });
});

app.get('/scan-qr-code', ensureAuthenticated, (req, res) => {
    res.render('scan-qr');
});


// Function to process each row (already implemented by you)
// ...

// Route to view data (protected)
app.get('/view-data', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    try {
        await client.connect();
        const result = await client.query(`
            SELECT ep.*, qc.qr_code_url, qc.qr_email_sent
            FROM event_participation ep
            LEFT JOIN qr_codes qc ON ep.id = qc.event_participation_id
            ORDER BY ep.id ASC
        `);
        const eventData = result.rows;
        res.render('view-data', { data: eventData });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data from the database.');
    } finally {
        await client.end();
    }
});

// Function to process a row (already implemented by you)
async function processRow(row, client) {
    try {
        const timestampValue = row['Timestamp'];
        let convertedTimestamp = null;

        // // Validate the timestamp and handle invalid dates
        // if (moment(timestampValue, 'DD/MM/YYYY HH:mm:ss', true).isValid()) {
        //     convertedTimestamp = moment(timestampValue, 'DD/MM/YYYY HH:mm:ss').format('YYYY-MM-DD HH:mm:ss');
        // } else {
        //     console.warn(`Invalid date format for row: ${JSON.stringify(row)}`);
        //     convertedTimestamp = null; // Insert NULL if the date is invalid
        // }

        // Insert into event_participation table
        const result = await client.query(
            `INSERT INTO event_participation 
            (email_address, first_name, last_name, mobile_number, number_of_tickets, car_parking, torch_burn_ravan_effigy, samosa, dabeli, vada_idli_combo, jalebi, car_registration_number, payable_total, payable_status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id`,
            [
                row['Email address'],
                row['First Name'],
                row['Last Name'],
                row['Mobile Number'],
                row['Number of Tickets'],
                row['Car Parking'],
                row['Torch/Burn Ravan Effigy'],
                row['Samosa'],
                row['Dabeli'],
                row['Vada-Idli Combo'],
                row['Jalebi'],
                row['Car Registration Number'],
                row['Payable Total'],
                row['Payable Status']
            ]
        );

        const eventParticipationId = result.rows[0].id;

        // Insert into validation_status table
        await client.query(
            `INSERT INTO validation_status (event_participation_id, entry_validated, food_collected, parking_validated) 
            VALUES ($1, $2, $3, $4)`,
            [eventParticipationId, false, false, false]
        );

        console.log(`Processed row: ${JSON.stringify(row)}`);

    } catch (error) {
        console.error(`Error inserting row: ${JSON.stringify(row)}`, error);
        throw error; // Ensure the error is caught and handled at the higher level
    }
}

// Scan QR code and view data for participant
app.get('/scan/:id', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Fetch participant details
        const result = await client.query(`
            SELECT ep.*, vs.entry_validated, vs.food_collected, vs.parking_validated
            FROM event_participation ep
            LEFT JOIN validation_status vs ON ep.id = vs.event_participation_id
            WHERE ep.id = $1
        `, [id]);

        const eventData = result.rows[0];

        if (eventData) {
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

// Route to update parking status
app.post('/update/parking/:id', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();
        // Update parking status to TRUE
        await client.query('UPDATE validation_status SET parking_validated = TRUE WHERE event_participation_id = $1', [id]);
        res.json({ message: 'Parking status updated successfully!' });
    } catch (error) {
        console.error('Error updating parking status:', error);
        res.status(500).json({ message: 'Error updating parking status.' });
    } finally {
        await client.end();
    }
});

// Route to update food collection status
app.post('/update/food/:id', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();
        // Update food_collected status
        await client.query('UPDATE validation_status SET food_collected = TRUE WHERE event_participation_id = $1', [id]);
        res.json({ message: 'Food collection validated successfully!' });
    } catch (error) {
        console.error('Error updating food collection status:', error);
        res.status(500).json({ message: 'Error updating food collection status.' });
    } finally {
        await client.end();
    }
});

// Route to update entry validation status
app.post('/update/entry/:id', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();
        // Update entry_validated status
        await client.query('UPDATE validation_status SET entry_validated = TRUE WHERE event_participation_id = $1', [id]);
        res.json({ message: 'Entry validated successfully!' });
    } catch (error) {
        console.error('Error updating entry validation status:', error);
        res.status(500).json({ message: 'Error updating entry validation status.' });
    } finally {
        await client.end();
    }
});

// Route to generate and store a QR code for a participant
app.post('/generate-qr/:id', ensureAuthenticated, async (req, res) => {
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

        // Generate the QR code by encoding only the participant's ID
        const qrCodeData = await qrcode.toDataURL(id.toString());

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


// Route to send the QR code via email as an attachment with HTML content
app.post('/email-qr/:id', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Fetch the participant's details
        const result = await client.query(`
            SELECT ep.first_name, ep.last_name, ep.email_address
            FROM event_participation ep
            WHERE ep.id = $1
        `, [id]);

        const participant = result.rows[0];

        if (!participant) {
            return res.status(404).json({ message: 'Participant not found' });
        }

        // Generate QR code
        const qrCodePath = path.join(__dirname, 'public/qrcodes', `${id}-qrcode.png`);
        await qrcode.toFile(qrCodePath, id.toString());  // Using the ID as QR code content

        // Load the HTML template
        const htmlFilePath = path.join(__dirname, 'templates/invite.html');
        let emailHtml = fs.readFileSync(htmlFilePath, 'utf8');

        // Replace the placeholders in the HTML template
        emailHtml = emailHtml.replace('SHCS/0001', `SHCS/${id}`);
        emailHtml = emailHtml.replace('Namaste Sanjeev Bansal ji', `Namaste ${participant.first_name} ${participant.last_name} ji`);
        emailHtml = emailHtml.replace(
            'Your Registration',
            `<small>Your event QR code is attached to this email. Please keep it handy for easy access at the event.</small>`
        );

        // Prepare the email options
        const mailOptions = {
            from: process.env.ALERT_EMAIL,
            to: participant.email_address,  // Use participant's email
            subject: 'Dussehra Mela 2024 - Sanatan Hindu Cultural Society - Sutton',
            html: emailHtml,  // Send the dynamic HTML as the email content
            attachments: [
                {
                    filename: 'qr-code.png',
                    path: qrCodePath,
                    contentType: 'image/png'
                }
            ]
        };

        // Send the email
        transporter.sendMail(mailOptions, async (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                return res.status(500).json({ message: 'Error sending email' });
            }

            try {
                // Mark the QR code email as sent in the database
                await client.query(
                    'UPDATE qr_codes SET qr_email_sent = TRUE WHERE event_participation_id = $1',
                    [id]
                );

                // Delete the QR code file after sending
                fs.unlinkSync(qrCodePath);

                console.log(`QR code emailed successfully to ${participant.email_address}`);
                return res.json({ message: 'QR code emailed successfully!' });
            } catch (dbError) {
                console.error('Error updating database:', dbError);
                return res.status(500).json({ message: 'Error updating QR email status in the database.' });
            } finally {
                await client.end();
            }
        });

    } catch (error) {
        console.error('Error fetching data or sending email:', error);
        await client.end();
        return res.status(500).json({ message: 'Error processing request' });
    }
});


// Setup nodemailer transporter
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.ALERT_EMAIL, // Office365 email
        pass: process.env.ALERT_EMAIL_PASSWORD       // Office365 password
    },
    tls: {
        ciphers: 'SSLv3'
    }
});

// Route to generate QR codes for all users
app.post('/generate-all-qrs', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    try {
        await client.connect();

        // Fetch all users from event_participation
        const result = await client.query('SELECT id FROM event_participation');
        const users = result.rows;

        for (const user of users) {
            // Check if the QR code already exists for the user
            const existingQRCode = await client.query('SELECT * FROM qr_codes WHERE event_participation_id = $1', [user.id]);

            if (existingQRCode.rows.length === 0) {
                // Generate the QR code and store it in the database
                const qrCodeData = await qrcode.toDataURL(`${user.id}`);
                await client.query('INSERT INTO qr_codes (event_participation_id, qr_code_url) VALUES ($1, $2)', [user.id, qrCodeData]);
            }
        }

        res.json({ message: 'QR codes generated successfully for all users!' });
    } catch (error) {
        console.error('Error generating QR codes for all users:', error);
        res.status(500).json({ message: 'Error generating QR codes for all users.' });
    } finally {
        await client.end();
    }
});



// Helper function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Route to email all users their QR codes with a 5-second delay between each email
app.post('/email-all-users', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);

    try {
        await client.connect();

        // Fetch all participants who haven't been emailed their QR codes yet
        const result = await client.query(`
            SELECT ep.id, ep.first_name, ep.last_name, ep.email_address
            FROM event_participation ep
            LEFT JOIN qr_codes qc ON ep.id = qc.event_participation_id
            WHERE qc.qr_email_sent = FALSE OR qc.qr_email_sent IS NULL
        `);

        const participants = result.rows;

        if (participants.length === 0) {
            return res.status(200).json({ message: 'All QR codes have already been sent.' });
        }

        for (const participant of participants) {
            const { id, first_name, last_name, email_address } = participant;

            // Generate QR code
            const qrCodePath = path.join(__dirname, 'public/qrcodes', `${id}-qrcode.png`);
            await qrcode.toFile(qrCodePath, id.toString());

            // Load the HTML template
            const htmlFilePath = path.join(__dirname, 'templates/invite.html');
            let emailHtml = fs.readFileSync(htmlFilePath, 'utf8');

            // Replace the placeholders in the HTML template
            emailHtml = emailHtml.replace('SHCS/0001', `SHCS/${id}`);
            emailHtml = emailHtml.replace('Namaste Sanjeev Bansal ji', `Namaste ${first_name} ${last_name} ji`);
            emailHtml = emailHtml.replace(
                'Your Registration',
                `<small>Your event QR code is attached to this email. Please keep it handy for easy access at the event.</small>`
            );

            // Prepare the email options
            const mailOptions = {
                from: process.env.ALERT_EMAIL,
                to: email_address,  // Send to participant's email
                subject: 'Dussehra Mela 2024 - Sanatan Hindu Cultural Society - Sutton',
                html: emailHtml,  // Send the dynamic HTML as the email content
                attachments: [
                    {
                        filename: 'qr-code.png',
                        path: qrCodePath,
                        contentType: 'image/png'
                    }
                ]
            };

            // Send the email
            await new Promise((resolve, reject) => {
                transporter.sendMail(mailOptions, async (error, info) => {
                    if (error) {
                        console.error('Error sending email:', error);
                        reject(error);
                    } else {
                        try {
                            // Mark the QR code email as sent in the database
                            await client.query(
                                'UPDATE qr_codes SET qr_email_sent = TRUE WHERE event_participation_id = $1',
                                [id]
                            );

                            // Delete the QR code file after sending
                            fs.unlinkSync(qrCodePath);

                            console.log(`QR code emailed successfully to ${email_address}`);
                            resolve();
                        } catch (dbError) {
                            console.error('Error updating database:', dbError);
                            reject(dbError);
                        }
                    }
                });
            });

            // Delay between emails (5 seconds)
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        return res.json({ message: 'QR codes emailed to all participants successfully!' });

    } catch (error) {
        console.error('Error emailing all users:', error);
        return res.status(500).json({ message: 'Error processing request' });
    } finally {
        await client.end();
    }
});


app.post('/resend-qr/:id', ensureAuthenticated, async (req, res) => {
    const client = new Client(clientConfig);
    const { id } = req.params;

    try {
        await client.connect();

        // Fetch the participant's details
        const result = await client.query(`
            SELECT ep.first_name, ep.last_name, ep.email_address
            FROM event_participation ep
            WHERE ep.id = $1
        `, [id]);

        const participant = result.rows[0];

        if (!participant) {
            return res.status(404).json({ message: 'Participant not found' });
        }

        // Generate QR code
        const qrCodePath = path.join(__dirname, 'public/qrcodes', `${id}-qrcode.png`);
        await qrcode.toFile(qrCodePath, id.toString());  // Using ID as QR code content

        // Load the HTML template
        const htmlFilePath = path.join(__dirname, 'templates/invite.html');
        let emailHtml = fs.readFileSync(htmlFilePath, 'utf8');

        // Replace the placeholders in the HTML template
        emailHtml = emailHtml.replace('SHCS/0001', `SHCS/${id}`);
        emailHtml = emailHtml.replace('Namaste Sanjeev Bansal ji', `Namaste ${participant.first_name} ${participant.last_name} ji`);
        emailHtml = emailHtml.replace(
            'Your Registration',
            `<small>Your event QR code is attached to this email. Please keep it handy for easy access at the event.</small>`
        );

        // Prepare the email options
        const mailOptions = {
            from: process.env.ALERT_EMAIL,
            to: participant.email_address,  // Use participant's email
            subject: 'Dussehra Mela 2024 - Sanatan Hindu Cultural Society - Sutton',
            html: emailHtml,  // Send the dynamic HTML as the email content
            attachments: [
                {
                    filename: 'qr-code.png',
                    path: qrCodePath,
                    contentType: 'image/png'
                }
            ]
        };

        // Send the email
        transporter.sendMail(mailOptions, async (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                return res.status(500).json({ message: 'Error sending email' });
            }

            try {
                // Mark the QR code email as re-sent in the database
                await client.query(
                    'UPDATE qr_codes SET qr_email_sent = TRUE WHERE event_participation_id = $1',
                    [id]
                );

                // Delete the QR code file after sending
                fs.unlinkSync(qrCodePath);

                console.log('QR code re-sent successfully');
                return res.json({ message: 'QR code re-sent successfully!' });
            } catch (dbError) {
                console.error('Error updating database:', dbError);
                return res.status(500).json({ message: 'Error updating QR email status in the database.' });
            } finally {
                await client.end();
            }
        });

    } catch (error) {
        console.error('Error fetching data or sending email:', error);
        await client.end();
        return res.status(500).json({ message: 'Error processing request' });
    }
});




// Start the server
app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
