/**
 * ACN Broadband & Mr.OTT CRM
 * Single-file application logic to support direct local file access (file://)
 */

// --- FIREBASE CONFIGURATION ---
// IMPORTANT: Replace this placeholder with your actual configuration from Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyAi9MmZ8Q5mjDkfJyDuGBNglpsvXVxI3HQ",
    authDomain: "acn-crm-e6d2b.firebaseapp.com",
    projectId: "acn-crm-e6d2b",
    storageBucket: "acn-crm-e6d2b.firebasestorage.app",
    messagingSenderId: "335754989768",
    appId: "1:335754989768:web:7789f080824f4f7f7f15fd",
    measurementId: "G-M9B6B685EH"
};

// Check if firebase is available
const isFirebaseAvailable = typeof firebase !== 'undefined';

// Initialize Firebase
let db = null;
if (isFirebaseAvailable) {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
    } catch (err) {
        console.error("Firebase initialization failed:", err);
    }
}
const AUTH_KEY = 'acn_crm_auth';
const STORAGE_KEY = 'acn_crm_data';

// --- DATA LAYER ---
let globalStore = { customers: [], recharges: [] };

async function syncStore(callback) {
    const statusEl = document.getElementById('connection-status');
    const updateStatus = (status, color, debugInfo = null) => {
        if (statusEl) {
            statusEl.textContent = status;
            statusEl.style.color = color;
            if (debugInfo) {
                statusEl.title = debugInfo; // Show error on hover
                console.error("Firebase Debug:", debugInfo);
            }
        }
    };

    // If Firebase failed or not configured, fallback to LocalStorage
    if (!db || firebaseConfig.apiKey === "YOUR_API_KEY") {
        const data = localStorage.getItem(STORAGE_KEY);
        globalStore = data ? JSON.parse(data) : { customers: [], recharges: [] };
        updateStatus('Local Mode (No Firebase)', 'var(--warning)');
        if (callback) callback();
        return;
    }

    let hasResponded = false;
    const timeout = setTimeout(() => {
        if (!hasResponded) {
            hasResponded = true;
            console.warn("Firebase timeout - using local storage");
            const data = localStorage.getItem(STORAGE_KEY);
            globalStore = data ? JSON.parse(data) : { customers: [], recharges: [] };
            updateStatus('Offline Fallback', 'var(--warning)');
            if (callback) callback();
        }
    }, 4000);

    try {
        db.collection("crm_data").doc("main").onSnapshot((doc) => {
            if (!hasResponded) {
                clearTimeout(timeout);
                hasResponded = true;
            }
            if (doc.exists) {
                globalStore = doc.data();
                updateStatus('Cloud Synced', 'var(--success)');
                localStorage.setItem(STORAGE_KEY, JSON.stringify(globalStore));
                if (callback) callback();
            } else {
                // First time setup - Migrate local data to cloud
                const localData = localStorage.getItem(STORAGE_KEY);
                const initialData = localData ? JSON.parse(localData) : { customers: [], recharges: [] };
                db.collection("crm_data").doc("main").set(initialData).then(() => {
                    updateStatus('Cloud Synced (Migrated)', 'var(--success)');
                }).catch(e => {
                    updateStatus('Cloud Permissions Error', 'var(--danger)', e.message);
                });
                globalStore = initialData;
                if (callback) callback();
            }
        }, (error) => {
            console.error("Firestore error:", error);
            // If we get an error, immediately fallback so user isn't stuck
            if (!hasResponded) {
                clearTimeout(timeout);
                hasResponded = true;
                const data = localStorage.getItem(STORAGE_KEY);
                globalStore = data ? JSON.parse(data) : { customers: [], recharges: [] };
                if (callback) callback();
            }

            let msg = 'Cloud Error';
            if (error.code === 'permission-denied') msg = 'Cloud Setup Required (Rules)';
            if (error.code === 'network-request-failed') msg = 'No Internet Sync';
            updateStatus(msg, 'var(--danger)', error.message);
        });
    } catch (e) {
        console.error("Snapshot failed:", e);
        updateStatus('Connection Failed', 'var(--danger)', e.message);
        if (!hasResponded) {
            hasResponded = true;
            if (callback) callback();
        }
    }
}

function getStore() {
    return globalStore;
}

async function saveStore(data) {
    globalStore = data;
    // Save to LocalStorage first (for offline/fallback)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    // Then try saving to Firebase
    if (db && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        try {
            await db.collection("crm_data").doc("main").set(data, { merge: true });
        } catch (e) {
            console.error("Sync to cloud failed:", e);
        }
    }
}

function calculateStatus(expiryDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    expiry.setHours(0, 0, 0, 0);

    if (expiry < today) return "Expired";

    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 3) return "Due Soon";
    return "Active";
}

// --- AUTH LAYER ---
function getCurrentUser() {
    const auth = localStorage.getItem(AUTH_KEY);
    return auth ? JSON.parse(auth) : null;
}

function login(username, role) {
    const user = { username, role };
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
    return user;
}

function logout() {
    localStorage.removeItem(AUTH_KEY);
}

// --- APP LAYER ---
class App {
    constructor() {
        this.currentPage = 'dashboard';
        this.user = getCurrentUser();
        this.isInitialized = false;
        this.init();
    }

    async init() {
        if (!this.user) {
            this.showLogin();
        } else {
            // Show a simple loading state while waiting for Firebase
            document.getElementById('page-content').innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: var(--text-muted);">
                    <div class="logo-icon" style="margin-bottom: 1rem; width: 40px; height: 40px; animation: pulse 1.5s infinite;">
                        <i data-lucide="wifi"></i>
                    </div>
                    <p>Syncing data from cloud...</p>
                </div>
            `;

            // Sync with Firebase then render
            await syncStore(() => {
                this.showApp();
                if (!this.isInitialized) {
                    this.setupNavigation();
                    this.isInitialized = true;
                }
                this.renderPage(this.currentPage);
                if (window.lucide) lucide.createIcons();
            });
        }
    }

    showLogin() {
        const app = document.getElementById('app');
        const loginScreen = document.getElementById('login-screen');
        app.style.display = 'none';
        loginScreen.style.display = 'flex';

        loginScreen.className = 'login-wrapper';
        loginScreen.innerHTML = `
            <div class="card" style="width: 100%; max-width: 400px; padding: 2.5rem; text-align: left;">
                <div style="text-align: center; margin-bottom: 2rem;">
                    <div class="logo-icon" style="margin: 0 auto 1rem; width: 48px; height: 48px;">
                        <i data-lucide="wifi"></i>
                    </div>
                    <h1 style="font-size: 1.5rem; margin-bottom: 0.25rem;">Welcome Back</h1>
                    <p style="color: var(--text-muted);">Login to ACN Broadband CRM</p>
                </div>
                
                <form id="login-form">
                    <div class="form-group">
                        <label>Username</label>
                        <input type="text" id="login-username" placeholder="Enter username" required>
                    </div>
                    <div class="form-group" style="margin-bottom: 2rem;">
                        <label>Password</label>
                        <input type="password" id="login-password" placeholder="Enter password" required>
                    </div>
                    
                    <div id="login-error" style="color: var(--danger); font-size: 0.875rem; margin-bottom: 1rem; display: none;">
                        Invalid username or password
                    </div>

                    <button type="submit" class="btn btn-primary" style="width: 100%; height: 44px; font-size: 1rem;">
                        Sign In
                    </button>
                </form>
            </div>
        `;

        const styleId = 'login-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                .login-wrapper {
                    height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, var(--primary) 0%, #1e40af 100%);
                }
            `;
            document.head.appendChild(style);
        }

        document.getElementById('login-form').onsubmit = (e) => {
            e.preventDefault();
            this.handleLogin();
        };

        if (window.lucide) lucide.createIcons();
    }

    handleLogin() {
        const userVal = document.getElementById('login-username').value;
        const passVal = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        let role = null;
        if (userVal === 'admin' && passVal === 'Admin@4200') {
            role = 'Admin';
        } else if (userVal === 'staff' && passVal === 'Staff@123') {
            role = 'Staff';
        }

        if (role) {
            login(userVal === 'admin' ? 'Admin' : 'Staff', role);
            window.location.reload();
        } else {
            errorEl.style.display = 'block';
        }
    }

    showApp() {
        document.getElementById('app').style.display = 'flex';
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('user-role').textContent = this.user.role;
        document.getElementById('user-name').textContent = this.user.username;

        // Add status indicator if it doesn't exist
        if (!document.getElementById('connection-status')) {
            const footer = document.querySelector('.sidebar-footer');
            const statusDiv = document.createElement('div');
            statusDiv.id = 'connection-status';
            statusDiv.style.cssText = 'font-size: 10px; margin-top: 0.5rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;';
            statusDiv.textContent = 'Connecting...';
            footer.insertBefore(statusDiv, footer.firstChild);
        }

        document.getElementById('logout-btn').onclick = () => {
            logout();
            window.location.reload();
        };

        // Mobile Toggle Logic
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const toggleBtn = document.getElementById('mobile-toggle');

        const toggleSidebar = () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        };

        toggleBtn.onclick = toggleSidebar;
        overlay.onclick = toggleSidebar;
    }

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item[data-page]');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');

        navItems.forEach(item => {
            item.onclick = (e) => {
                const page = e.currentTarget.getAttribute('data-page');
                navItems.forEach(i => i.classList.remove('active'));
                e.currentTarget.classList.add('active');

                // Close sidebar on mobile after selection
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('open');
                    overlay.classList.remove('active');
                }

                this.renderPage(page);
            };
        });
    }

    renderPage(pageId) {
        this.currentPage = pageId;
        const container = document.getElementById('page-content');
        const title = document.getElementById('page-title');
        const actions = document.getElementById('header-actions');

        actions.innerHTML = '';

        switch (pageId) {
            case 'dashboard':
                title.textContent = 'Dashboard Overview';
                this.renderDashboard(container);
                break;
            case 'customers':
                title.textContent = 'Customer Directory';
                this.renderCustomers(container, actions);
                this.setupCustomerListeners();
                break;
            case 'recharge':
                title.textContent = 'New Recharge Entry';
                this.renderRecharge(container);
                break;
            case 'due-tracking':
                title.textContent = 'Due & Expiry Tracking';
                this.renderDueTracking(container);
                break;
            case 'reports':
                title.textContent = 'Performance Reports';
                this.renderReports(container, actions);
                break;
        }
        if (window.lucide) lucide.createIcons();
    }

    renderDashboard(container) {
        const store = getStore();
        store.customers.forEach(c => c.status = calculateStatus(c.expiryDate));

        const total = store.customers.length;
        const active = store.customers.filter(c => c.status === 'Active').length;
        const expired = store.customers.filter(c => c.status === 'Expired').length;
        const todayCollection = store.recharges.filter(r => r.date === new Date().toISOString().split('T')[0])
            .reduce((acc, r) => acc + r.amount, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const fourDaysLater = new Date();
        fourDaysLater.setDate(today.getDate() + 4);
        fourDaysLater.setHours(23, 59, 59, 999);

        const upcomingExpiries = store.customers.filter(c => {
            const expiry = new Date(c.expiryDate);
            return expiry >= today && expiry <= fourDaysLater;
        });

        container.innerHTML = `
            <div class="stat-grid">
                <div class="card stat-card">
                    <h3>Total Customers</h3>
                    <div class="value">${total}</div>
                </div>
                <div class="card stat-card">
                    <h3>Active Customers</h3>
                    <div class="value" style="color: var(--success);">${active}</div>
                </div>
                <div class="card stat-card">
                    <h3>Expired Customers</h3>
                    <div class="value" style="color: var(--danger);">${expired}</div>
                </div>
                <div class="card stat-card">
                    <h3>Today's Collection</h3>
                    <div class="value" style="color: var(--primary);">₹${todayCollection}</div>
                </div>
            </div>

            ${upcomingExpiries.length > 0 ? `
            <div class="card" style="margin-top: 2rem; border-left: 4px solid var(--warning);">
                <h3 style="margin-bottom: 1rem; color: var(--warning); display: flex; align-items: center; gap: 8px;">
                    <i data-lucide="bell" style="width: 20px;"></i> Upcoming Expiries (Next 4 Days)
                </h3>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Phone</th>
                                <th>Expiry Date</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${upcomingExpiries.map(c => `
                                <tr>
                                    <td><strong>${c.name}</strong></td>
                                    <td>${c.phone}</td>
                                    <td>${c.expiryDate}</td>
                                    <td><span class="badge badge-${c.status.toLowerCase().replace(' ', '-')}">${c.status}</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-edit" data-id="${c.id}" style="padding: 4px 8px; font-size: 11px;">View</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}

            <div class="card" style="margin-top: 2rem;">
                <h3 style="margin-bottom: 1.5rem;">Daily Collection Chart</h3>
                <div id="collection-chart" style="height: 300px; display: flex; align-items: flex-end; gap: 10px; padding: 10px;">
                    ${this.generateChart(store.recharges)}
                </div>
            </div>
        `;

        // Setup listeners for the new "Upcoming Expiries" View buttons
        if (upcomingExpiries.length > 0) {
            container.querySelectorAll('.btn-edit').forEach(btn => {
                btn.onclick = (e) => this.renderEditCustomerForm(e.currentTarget.getAttribute('data-id'));
            });
        }
    }

    generateChart(recharges) {
        const days = 7;
        const data = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const amount = recharges.filter(r => r.date === dateStr).reduce((acc, r) => acc + r.amount, 0);
            data.push({ date: dateStr, amount });
        }

        const max = Math.max(...data.map(d => d.amount), 1000);

        return data.map(d => {
            const height = (d.amount / max) * 100;
            return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                    <div style="width: 100%; background: var(--primary-light); border-radius: 4px; position: relative; height: 200px; overflow: hidden;">
                        <div style="position: absolute; bottom: 0; width: 100%; height: ${height}%; background: var(--primary); transition: height 0.5s;"></div>
                    </div>
                    <span style="font-size: 0.65rem; color: var(--text-muted);">${d.date.split('-')[2]} Feb</span>
                </div>
            `;
        }).join('');
    }

    renderCustomers(container, actions) {
        const store = getStore();
        if (this.user.role === 'Admin') {
            actions.innerHTML = `<button class="btn btn-primary" id="add-cust-btn">+ Add Customer</button>`;
            document.getElementById('add-cust-btn').onclick = () => this.renderAddCustomerForm(container);
        }

        container.innerHTML = `
            <div class="card" style="margin-bottom: 1.5rem;">
                <div style="display: flex; gap: 1rem;">
                    <div style="position: relative; flex: 1;">
                        <input type="text" placeholder="Search by name or ID..." id="cust-search" style="padding-left: 2.5rem;">
                        <i data-lucide="search" style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); width: 18px; color: var(--text-muted);"></i>
                    </div>
                    <select id="cust-status-filter" style="width: 200px;">
                        <option value="">All Statuses</option>
                        <option value="Active">Active Only</option>
                        <option value="Expired">Expired Only</option>
                        <option value="Due Soon">Due Soon</option>
                    </select>
                </div>
            </div>
            <div class="table-container">
                <table id="customer-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Plan</th>
                            <th>Expiry</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="customer-table-body">
                        ${this.renderCustomerRows(store.customers)}
                    </tbody>
                </table>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    }

    setupCustomerListeners() {
        const searchInput = document.getElementById('cust-search');
        const statusFilter = document.getElementById('cust-status-filter');
        const tableBody = document.getElementById('customer-table-body');

        if (!searchInput || !statusFilter || !tableBody) return;

        const filterCustomers = () => {
            const store = getStore();
            const searchTerm = searchInput.value.toLowerCase();
            const statusTerm = statusFilter.value;

            const filtered = store.customers.filter(c => {
                const matchesSearch = c.name.toLowerCase().includes(searchTerm) || c.id.toLowerCase().includes(searchTerm);
                const matchesStatus = statusTerm === "" || c.status === statusTerm;
                return matchesSearch && matchesStatus;
            });

            tableBody.innerHTML = this.renderCustomerRows(filtered);
            this.attachTableActionListeners();
        };

        searchInput.oninput = filterCustomers;
        statusFilter.onchange = filterCustomers;
        this.attachTableActionListeners();
    }

    renderAddCustomerForm(container) {
        document.getElementById('page-title').textContent = "Add New Customer";
        document.getElementById('header-actions').innerHTML = `
            <button class="btn" id="back-to-cust" style="border: 1px solid var(--border);">Cancel</button>
        `;
        document.getElementById('back-to-cust').onclick = () => this.renderPage('customers');

        container.innerHTML = `
            <div class="card" style="max-width: 800px; margin: 0 auto;">
                <form id="add-customer-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Customer Name</label>
                            <input type="text" id="new-cust-name" placeholder="Full Name" required>
                        </div>
                        <div class="form-group">
                            <label>Phone Number</label>
                            <input type="tel" id="new-cust-phone" placeholder="10-digit number" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Address</label>
                        <textarea id="new-cust-address" rows="3" placeholder="Full Address" required></textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Initial Plan</label>
                            <input type="text" id="new-cust-plan" placeholder="e.g. Fiber 50Mbps" required>
                        </div>
                        <div class="form-group">
                            <label>Plan Price (₹)</label>
                            <input type="number" id="new-cust-price" placeholder="0" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Initial Payment Mode</label>
                            <select id="new-cust-mode">
                                <option value="Cash">Cash</option>
                                <option value="UPI">UPI</option>
                                <option value="Bank">Bank Transfer</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Recharge Date</label>
                            <input type="date" id="new-cust-date" value="${new Date().toISOString().split('T')[0]}" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Notes (Optional)</label>
                        <input type="text" id="new-cust-notes" placeholder="Any specific details...">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Create Customer & Activate</button>
                </form>
            </div>
        `;

        document.getElementById('add-customer-form').onsubmit = (e) => {
            e.preventDefault();
            this.handleAddCustomerSubmit();
        };
    }

    handleAddCustomerSubmit() {
        const store = getStore();
        const name = document.getElementById('new-cust-name').value;
        const phone = document.getElementById('new-cust-phone').value;
        const address = document.getElementById('new-cust-address').value;
        const plan = document.getElementById('new-cust-plan').value;
        const price = parseFloat(document.getElementById('new-cust-price').value);
        const mode = document.getElementById('new-cust-mode').value;
        const date = document.getElementById('new-cust-date').value;
        const notes = document.getElementById('new-cust-notes').value;

        const expiryDate = new Date(date);
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryStr = expiryDate.toISOString().split('T')[0];

        // IMPROVED ID GENERATION: Find the highest existing number and add 1
        let maxNum = 0;
        store.customers.forEach(c => {
            const num = parseInt(c.id.replace('ACN', ''));
            if (!isNaN(num) && num > maxNum) maxNum = num;
        });
        const newId = "ACN" + (maxNum + 1).toString().padStart(3, '0');

        const newCustomer = {
            id: newId,
            name,
            phone,
            address,
            planName: plan,
            planPrice: price,
            rechargeDate: date,
            expiryDate: expiryStr,
            status: calculateStatus(expiryStr),
            paymentMode: mode,
            notes
        };

        store.customers.push(newCustomer);

        // Also add to recharge history
        store.recharges.push({
            id: 'RCH' + Date.now().toString().slice(-6),
            customerId: newId,
            amount: price,
            plan: plan,
            paymentMode: mode,
            date: date
        });

        saveStore(store);
        alert(`Customer ${newId} added successfully!`);
        this.renderPage('customers');
    }

    renderCustomerRows(customers) {
        return customers.map(c => `
            <tr>
                <td><span style="font-family: monospace; font-weight: 600;">${c.id}</span></td>
                <td>${c.name}</td>
                <td>${c.phone}</td>
                <td>${c.planName} (₹${c.planPrice})</td>
                <td>${c.expiryDate}</td>
                <td><span class="badge badge-${c.status.toLowerCase().replace(' ', '-')}">${c.status}</span></td>
                <td>
                    <button class="btn btn-sm btn-edit" data-id="${c.id}" style="padding: 4px 8px; font-size: 12px; border: 1px solid var(--border); background: white;">Edit</button>
                    ${this.user.role === 'Admin' ? `<button class="btn btn-sm btn-delete" data-id="${c.id}" style="color: var(--danger); padding: 4px 8px; font-size: 12px; border: 1px solid var(--border); background: white;">Delete</button>` : ''}
                </td>
            </tr>
        `).join('');
    }

    attachTableActionListeners() {
        document.querySelectorAll('.btn-edit').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                this.renderEditCustomerForm(id);
            };
        });

        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                if (confirm(`Are you sure you want to delete customer ${id}?`)) {
                    this.handleDeleteCustomer(id);
                }
            };
        });
    }

    handleDeleteCustomer(id) {
        const store = getStore();
        store.customers = store.customers.filter(c => c.id !== id);
        store.recharges = store.recharges.filter(r => r.customerId !== id);
        saveStore(store);
        this.renderPage('customers');
    }

    renderEditCustomerForm(id) {
        const store = getStore();
        const customer = store.customers.find(c => c.id === id);
        if (!customer) return;

        const container = document.getElementById('page-content');
        document.getElementById('page-title').textContent = `Edit Customer: ${id}`;
        document.getElementById('header-actions').innerHTML = `
            <button class="btn" id="back-to-cust" style="border: 1px solid var(--border);">Cancel</button>
        `;
        document.getElementById('back-to-cust').onclick = () => this.renderPage('customers');

        container.innerHTML = `
            <div class="card" style="max-width: 800px; margin: 0 auto;">
                <form id="edit-customer-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Customer Name</label>
                            <input type="text" id="edit-cust-name" value="${customer.name}" required>
                        </div>
                        <div class="form-group">
                            <label>Phone Number</label>
                            <input type="tel" id="edit-cust-phone" value="${customer.phone}" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Address</label>
                        <textarea id="edit-cust-address" rows="3" required>${customer.address}</textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Current Plan</label>
                            <input type="text" id="edit-cust-plan" value="${customer.planName}" required>
                        </div>
                        <div class="form-group">
                            <label>Plan Price (₹)</label>
                            <input type="number" id="edit-cust-price" value="${customer.planPrice}" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Notes</label>
                        <input type="text" id="edit-cust-notes" value="${customer.notes || ''}">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Update Customer Details</button>
                </form>
            </div>
        `;

        document.getElementById('edit-customer-form').onsubmit = (e) => {
            e.preventDefault();
            this.handleEditCustomerSubmit(id);
        };
    }

    handleEditCustomerSubmit(id) {
        const store = getStore();
        const customer = store.customers.find(c => c.id === id);
        if (!customer) return;

        customer.name = document.getElementById('edit-cust-name').value;
        customer.phone = document.getElementById('edit-cust-phone').value;
        customer.address = document.getElementById('edit-cust-address').value;
        customer.planName = document.getElementById('edit-cust-plan').value;
        customer.planPrice = parseFloat(document.getElementById('edit-cust-price').value);
        customer.notes = document.getElementById('edit-cust-notes').value;

        saveStore(store);
        alert(`Customer ${id} updated successfully!`);
        this.renderPage('customers');
    }

    renderRecharge(container) {
        const store = getStore();
        container.innerHTML = `
            <div class="card" style="max-width: 600px; margin: 0 auto;">
                <form id="recharge-form">
                    <div class="form-group">
                        <label>Select Customer</label>
                        <select id="rch-customer" required>
                            <option value="">-- Select Customer --</option>
                            ${store.customers.map(c => `<option value="${c.id}">${c.name} (${c.id})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div class="form-group">
                            <label>Plan Name</label>
                            <input type="text" id="rch-plan" placeholder="e.g. Fiber 100Mbps" required>
                        </div>
                        <div class="form-group">
                            <label>Amount (₹)</label>
                            <input type="number" id="rch-amount" placeholder="0" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Payment Mode</label>
                        <select id="rch-mode" required>
                            <option value="Cash">Cash</option>
                            <option value="UPI">UPI</option>
                            <option value="Bank">Bank Transfer</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Recharge Date</label>
                        <input type="date" id="rch-date" value="${new Date().toISOString().split('T')[0]}" required>
                    </div>
                    <p style="font-size: 0.825rem; color: var(--text-muted); margin-bottom: 1.5rem;">
                        Expiry will be auto-calculated to 30 days from now.
                    </p>
                    <button type="submit" class="btn btn-primary" style="width: 100%;">Save Recharge</button>
                </form>
            </div>
        `;

        document.getElementById('recharge-form').onsubmit = (e) => {
            e.preventDefault();
            this.handleRechargeSubmit();
        };
    }

    handleRechargeSubmit() {
        const store = getStore();
        const customerId = document.getElementById('rch-customer').value;
        const amount = parseFloat(document.getElementById('rch-amount').value);
        const plan = document.getElementById('rch-plan').value;
        const mode = document.getElementById('rch-mode').value;
        const date = document.getElementById('rch-date').value;

        const expiryDate = new Date(date);
        expiryDate.setDate(expiryDate.getDate() + 30);
        const expiryStr = expiryDate.toISOString().split('T')[0];

        store.recharges.push({
            id: 'RCH' + Date.now().toString().slice(-6),
            customerId,
            amount,
            plan,
            paymentMode: mode,
            date
        });

        const customer = store.customers.find(c => c.id === customerId);
        if (customer) {
            customer.expiryDate = expiryStr;
            customer.rechargeDate = date;
            customer.planName = plan;
            customer.planPrice = amount;
            customer.status = calculateStatus(expiryStr);
        }

        saveStore(store);
        alert('Recharge added successfully!');
        this.renderPage('dashboard');
    }

    renderDueTracking(container) {
        const store = getStore();
        const due = store.customers.filter(c => c.status === 'Due Soon' || c.status === 'Expired');

        container.innerHTML = `
            <div class="stat-grid" style="margin-bottom: 2rem;">
                <div class="card stat-card" style="border-left: 4px solid var(--danger);">
                    <h3>Immediate Attention</h3>
                    <div class="value">${due.length}</div>
                </div>
            </div>

            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Expiry Date</th>
                            <th>Status</th>
                            <th>Days Left</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${due.map(c => {
            const today = new Date();
            const expiry = new Date(c.expiryDate);
            const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
            return `
                                <tr>
                                    <td><strong>${c.name}</strong></td>
                                    <td>${c.phone}</td>
                                    <td>${c.expiryDate}</td>
                                    <td><span class="badge badge-${c.status.toLowerCase().replace(' ', '-')}">${c.status}</span></td>
                                    <td style="color: ${diffDays < 0 ? 'var(--danger)' : 'var(--warning)'}">${diffDays < 0 ? 'Expired' : diffDays + ' days'}</td>
                                    <td><button class="btn btn-sm" style="background: #25d366; color: white; display: flex; align-items: center; gap: 4px; border: none; font-size: 11px;">
                                        <i data-lucide="send" style="width:12px;height:12px;"></i> WhatsApp
                                    </button></td>
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    renderReports(container, actions) {
        const store = getStore();
        actions.innerHTML = `<button class="btn" style="border:1px solid var(--border);">Download CSV</button>`;

        const monthlyCollection = store.recharges.reduce((acc, r) => acc + r.amount, 0);

        container.innerHTML = `
            <div class="stat-grid">
                <div class="card stat-card">
                    <h3>Monthly Total</h3>
                    <div class="value">₹${monthlyCollection}</div>
                </div>
                <div class="card stat-card">
                    <h3>Total Recharges</h3>
                    <div class="value">${store.recharges.length}</div>
                </div>
            </div>

            <div class="card" style="margin-top:2rem;">
                <h3 style="margin-bottom:1rem;">Recent Transactions</h3>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Customer ID</th>
                                <th>Amount</th>
                                <th>Mode</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${store.recharges.slice(-10).reverse().map(r => `
                                <tr>
                                    <td>${r.date}</td>
                                    <td>${r.customerId}</td>
                                    <td>₹${r.amount}</td>
                                    <td>${r.paymentMode}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
}

// Ensure the DOM is fully loaded before initializing
window.addEventListener('DOMContentLoaded', () => {
    new App();
});
