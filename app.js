
// Firebase Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, onSnapshot, doc, setDoc, deleteDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

console.log("Initializing Firebase and securing connection...");


// Ensure firebase logging is enabled for debugging
setLogLevel('Debug');

// Global Firebase and App State
let app;
let db;
let auth;
let userId = 'loading...';
let libraryBooks = []; // Main array of book records
let currentBooks = []; // Array used for rendering (after filter/sort)
let sortState = { field: 'title', direction: 'asc' };
let currentView = 'table'; // 'table' or 'card'

// Fixed App ID and Firebase config (no environment variables needed)
const appId = 'libraryis-app';
const firebaseConfig = {
    apiKey: "AIzaSyBroWviBwwMeQz2o29_lfHWH695UsBqA-E",
    authDomain: "libraryis-87282.firebaseapp.com",
    projectId: "libraryis-87282",
    storageBucket: "libraryis-87282.firebasestorage.app",
    messagingSenderId: "992616952611",
    appId: "1:992616952611:web:6abbc327bb3ae8e7421296",
    measurementId: "G-HZFXJLJ0LW"
};
const initialAuthToken = null; // You can leave this null if you don’t have a custom token

/**
 * 1. Initialize Firebase and authenticate the user.
 */
async function initializeFirebase() {
    if (!firebaseConfig) {
        // --- UPDATED ERROR MESSAGE FOR CLARITY ---
        const errorMessage = 'Error: Firebase configuration is missing. The database connection cannot be established.';
        console.error(errorMessage);
        document.getElementById('loading-message').innerHTML = `
            <p class="text-red-600 font-bold mb-2">${errorMessage}</p>
            <p class="text-gray-600 text-sm">The required <code>__firebase_config</code> environment variable was not found or was invalid.</p>
            <p class="text-gray-600 text-sm mt-1">Please ensure the application is running in an environment that provides this configuration.</p>
        `;
        return;
        // ----------------------------------------
    }

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Authenticate user
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        // Set up auth state change listener to get the userId and start data loading
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                console.log(`User authenticated. User ID: ${userId}`);
                document.getElementById('user-id-display').textContent = `User ID: ${userId}`;
                setupRealtimeListener();
            } else {
                userId = crypto.randomUUID(); // Fallback to anonymous ID if auth fails
                document.getElementById('user-id-display').textContent = `User ID: (Anon) ${userId}`;
                console.log("No user signed in. Using anonymous ID.");
                setupRealtimeListener();
            }
        });

    } catch (error) {
        console.error("Error during Firebase initialization or authentication:", error);
        document.getElementById('loading-message').textContent = `Error: ${error.message}`;
    }
}

/**
 * 2. Setup Real-time Listener for Books
 */
function setupRealtimeListener() {
    const collectionPath = `/artifacts/${appId}/public/data/library_books`;
    const booksCollection = collection(db, collectionPath);
    const q = query(booksCollection);

    // onSnapshot provides real-time updates and initial data fetch
    onSnapshot(q, (snapshot) => {
        libraryBooks = [];
        snapshot.forEach((doc) => {
            const book = doc.data();
            book.id = doc.id; // Add Firestore document ID as unique identifier
            libraryBooks.push(book);
        });
        console.log("Real-time data update. Total books:", libraryBooks.length);
        applyFiltersAndSort(); // Re-render the list immediately
        document.getElementById('loading-overlay').classList.add('hidden');

        if (libraryBooks.length === 0) {
            // Auto-populate initial records if empty
            console.log("Library is empty. Auto-populating 5 initial records.");
            populateInitialBooks();
        }
    }, (error) => {
        console.error("Error listening to Firestore:", error);
    });
}

/**
 * Initial book data for auto-population
 */
const initialRecords = [
    { title: "To Kill a Mockingbird", author: "Harper Lee", year: 1960, quantity: 5, isbn: "9780061120084", isAvailable: true, borrowers: [] },
    { title: "1984", author: "George Orwell", year: 1949, quantity: 1, isbn: "9780451524935", isAvailable: false, borrowers: [] }, // Low stock
    { title: "The Martian", author: "Andy Weir", year: 2011, quantity: 12, isbn: "9780553418026", isAvailable: true, borrowers: [] },
    { title: "Pride and Prejudice", author: "Jane Austen", year: 1813, quantity: 0, isbn: "9780141439518", isAvailable: false, borrowers: [] }, // Out of stock
    { title: "Project Hail Mary", author: "Andy Weir", year: 2021, quantity: 7, isbn: "9780593135211", isAvailable: true, borrowers: [] },
];

async function populateInitialBooks() {
    const collectionPath = `/artifacts/${appId}/public/data/library_books`;
    for (const book of initialRecords) {
        // Use runTransaction to ensure uniqueness of ISBN before adding
        await runTransaction(db, async (transaction) => {
            const newDocRef = doc(collection(db, collectionPath));
            transaction.set(newDocRef, book);
        });
        console.log(`Initial book added: ${book.title}`);
    }
}


/**
 * 3. Core Book Operations (Attached to window for inline HTML calls)
 */

async function borrowBook(bookId) {
    const book = libraryBooks.find(b => b.id === bookId);
    if (!book) {
        displayMessage("Book not found.", "error");
        return;
    }

    if (!book.isAvailable || book.quantity <= 0) {
        displayMessage(`Cannot borrow "${book.title}". It is currently unavailable or out of stock.`, 'error');
        return;
    }

    const docRef = doc(db, `/artifacts/${appId}/public/data/library_books`, bookId);

    try {
        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(docRef);
            if (!sfDoc.exists()) throw "Document does not exist!";

            const currentBook = sfDoc.data();

            // Prevent double-borrowing by the same user
            if (currentBook.borrowers.includes(userId)) {
                throw "User already borrowed this book.";
            }

            const newQuantity = currentBook.quantity - 1;
            const newBorrowers = [...currentBook.borrowers, userId];

            // Add borrow history record
            const newHistory = currentBook.borrowHistory || [];
            newHistory.push({
                userId,
                borrowedAt: new Date().toISOString(),
            });

            transaction.update(docRef, {
                quantity: newQuantity,
                borrowers: newBorrowers,
                isAvailable: newQuantity > 0,
                borrowHistory: newHistory
            });
        });

        displayMessage(`"${book.title}" borrowed successfully.`, 'success');
        console.log(`Book ID ${bookId} borrowed by user ${userId}.`);

    } catch (e) {
        console.error("Borrow transaction failed: ", e);
        if (e === "User already borrowed this book.") {
            displayMessage(`You have already borrowed "${book.title}".`, 'error');
        } else {
            displayMessage('Borrowing failed due to a database error.', 'error');
        }
    }
}


// Book Object Method Simulation: Returning
async function returnBook(bookId) {
    const book = libraryBooks.find(b => b.id === bookId);
    if (!book) return;

    if (!book.borrowers.includes(userId)) {
        displayMessage(`You did not borrow "${book.title}". Cannot return.`, 'error');
        return;
    }

    const docRef = doc(db, `/artifacts/${appId}/public/data/library_books`, bookId);

    try {
        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(docRef);
            if (!sfDoc.exists()) {
                throw "Document does not exist!";
            }

            const currentBook = sfDoc.data();
            const newQuantity = currentBook.quantity + 1;
            const newBorrowers = currentBook.borrowers.filter(id => id !== userId); // Remove current user ID

            transaction.update(docRef, {
                quantity: newQuantity,
                borrowers: newBorrowers,
                isAvailable: newQuantity > 0,
            });
        });
        displayMessage(`"${book.title}" returned successfully.`, 'success');
        console.log(`Book ID ${bookId}: Book returned by user ${userId}.`);
    } catch (e) {
        console.error("Return transaction failed: ", e);
        displayMessage('Returning failed due to a database error.', 'error');
    }
}


// CRUD: Add/Update Book 
async function saveRecord(event) {
    event.preventDefault();

    const isbn = document.getElementById('isbn').value.trim();
    const title = document.getElementById('title').value.trim();
    const author = document.getElementById('author').value.trim();
    const year = parseInt(document.getElementById('year').value.trim());
    const quantity = parseInt(document.getElementById('quantity').value.trim());
    const idToUpdate = document.getElementById('record-id').value;

    // Validate inputs
    if (!isbn || !title || !author || isNaN(year) || isNaN(quantity) || year < 1000 || quantity < 0) {
        displayMessage('Validation Error: Please fill all fields correctly (Year must be > 1000, Quantity >= 0).', 'error');
        return;
    }

    const newBookData = {
        title, author, year, quantity, isbn,
        isAvailable: quantity > 0,
        borrowers: [], // Will be updated by transactions
        borrowDate: new Date().toISOString().split('T')[0]
    };

    const collectionPath = `/artifacts/${appId}/public/data/library_books`;

    if (idToUpdate) {
        // Update existing record
        const docRef = doc(db, collectionPath, idToUpdate);
        try {
            await setDoc(docRef, {
                title: newBookData.title,
                author: newBookData.author,
                year: newBookData.year,
                quantity: newBookData.quantity,
                isAvailable: newBookData.isAvailable,
            }, { merge: true });

            displayMessage(`Book updated successfully: ${title}`, 'success');
            console.log(`Book updated (ID: ${idToUpdate}): `, newBookData);
            document.getElementById('record-form').reset();
            document.getElementById('record-id').value = '';
            document.getElementById('form-submit-button').textContent = 'Add Record';
        } catch (e) {
            console.error("Error updating document: ", e);
            displayMessage('Error updating book.', 'error');
        }
    } else {
        // Add new record (Must check for unique ISBN first)
        if (libraryBooks.some(b => b.isbn === isbn)) {
            displayMessage('Error: Book with this ISBN already exists. Use the "Search" and "Edit" functionality to update.', 'error');
            return;
        }

        try {
            const newDocRef = doc(collection(db, collectionPath));
            await setDoc(newDocRef, newBookData);
            displayMessage(`New book added: ${title}`, 'success');
            console.log('New book added: ', newBookData);
            document.getElementById('record-form').reset();
        } catch (e) {
            console.error("Error adding document: ", e);
            displayMessage('Error adding new book.', 'error');
        }
    }
}

// CRUD: Delete Record (On Delete, confirm before removing)
function promptDelete(bookId, title) {
    showCustomConfirmation(`Are you sure you want to permanently delete the book: "${title}"?`, () => deleteRecord(bookId));
}

async function deleteRecord(bookId) {
    const docRef = doc(db, `/artifacts/${appId}/public/data/library_books`, bookId);
    const book = libraryBooks.find(b => b.id === bookId);

    if (!book) return;

    try {
        await deleteDoc(docRef);
        displayMessage(`Book deleted: ${book.title}`, 'success');
        console.log(`Book deleted (ID: ${bookId}): ${book.title}`);
        document.getElementById('record-form').reset();
        document.getElementById('record-id').value = '';
        document.getElementById('form-submit-button').textContent = 'Add Record';

    } catch (e) {
        console.error("Error deleting document: ", e);
        displayMessage('Error deleting book.', 'error');
    }
}

// CRUD: Update Record (Set form fields for editing)
function editRecord(bookId) {
    const book = libraryBooks.find(b => b.id === bookId);
    if (!book) return;

    document.getElementById('record-id').value = book.id;
    document.getElementById('isbn').value = book.isbn;
    document.getElementById('title').value = book.title;
    document.getElementById('author').value = book.author;
    document.getElementById('year').value = book.year;
    document.getElementById('quantity').value = book.quantity;

    // Change button text to indicate update mode
    document.getElementById('form-submit-button').textContent = 'Update Record';

    displayMessage(`Editing book: ${book.title}. Enter new values and click Update Record.`, 'info');
}

// Reset form and view state
function resetApp() {
    document.getElementById('record-form').reset();
    document.getElementById('record-id').value = '';
    document.getElementById('form-submit-button').textContent = 'Add Record';
    document.getElementById('search-input').value = '';
    document.getElementById('filter-select').value = 'none';
    sortState = { field: 'title', direction: 'asc' };
    displayMessage('System reset to default view.', 'info');
    applyFiltersAndSort();
}


/**
 * 4. Search, Filter, and Sort Logic
 */

// Custom Search Function
function customSearch(query, records) {
    const lowerCaseQuery = query.toLowerCase();
    if (!lowerCaseQuery) return records;

    console.log(`Executing custom search for: "${query}"`);

    // Search by ISBN (unique), Title, or Author
    return records.filter(book =>
        book.isbn.toLowerCase().includes(lowerCaseQuery) ||
        book.title.toLowerCase().includes(lowerCaseQuery) ||
        book.author.toLowerCase().includes(lowerCaseQuery)
    );
}

function applyFiltersAndSort() {
    let filtered = [...libraryBooks];
    const filterValue = document.getElementById('filter-select').value;
    const searchValue = document.getElementById('search-input').value;

    // Apply Filter
    if (filterValue === 'low_stock') {
        filtered = filtered.filter(book => book.quantity <= 1);
        console.log(`Filter applied: Low Stock (Quantity <= 1). ${filtered.length} results.`);
    } else if (filterValue === 'old_books') {
        const currentYear = new Date().getFullYear();
        filtered = filtered.filter(book => currentYear - book.year > 10);
        console.log(`Filter applied: Old Books (Published > 10 years ago). ${filtered.length} results.`);
    }

    // Apply Search
    if (searchValue) {
        filtered = customSearch(searchValue, filtered);
    }

    // Apply Sort
    filtered.sort((a, b) => {
        const aValue = a[sortState.field];
        const bValue = b[sortState.field];

        let comparison = 0;
        if (typeof aValue === 'string') {
            comparison = aValue.localeCompare(bValue); // String comparison for Title
        } else {
            comparison = aValue - bValue; // Numeric comparison for Year/Quantity
        }

        return sortState.direction === 'asc' ? comparison : comparison * -1;
    });

    currentBooks = filtered;
    renderBooks();
    updateSummary();
}

// On Sort, toggle ascending/descending
function sortRecords(field) {
    if (sortState.field === field) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.field = field;
        sortState.direction = 'asc'; // Default to ascending when changing field
    }
    console.log(`Sorting by ${sortState.field} (${sortState.direction})`);
    applyFiltersAndSort();
}

// Toggle view (table vs. card view)
function toggleView() {
    currentView = currentView === 'table' ? 'card' : 'table';
    document.getElementById('view-toggle-button').textContent = currentView === 'table' ? 'Switch to Card View' : 'Switch to Table View';
    document.getElementById('view-name').textContent = `(${currentView === 'table' ? 'Table' : 'Card'} View)`;
    renderBooks();
}


/**
 * 5. DOM Manipulation and Rendering
 */

// Helper to get sort icon
function getSortIcon(field) {
    if (sortState.field !== field) return '';
    return sortState.direction === 'asc' ? ' ▲' : ' ▼';
}

function renderBooks() {
    const listContainer = document.getElementById('books-list');
    listContainer.innerHTML = '';

    if (currentBooks.length === 0) {
        listContainer.innerHTML = `<p class="text-center text-gray-500 py-6">No books found matching the current criteria.</p>`;
        return;
    }

    if (currentView === 'table') {
        renderTableView(listContainer);
    } else {
        renderCardView(listContainer);
    }
}

// Render Table View
function renderTableView(container) {
    const tableHTML = `
        <table class="min-w-full bg-white rounded-xl overflow-hidden shadow-lg">
            <thead>
                <tr class="bg-gray-100 border-b border-gray-200">
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer" onclick="window.sortRecords('title')">Title${getSortIcon('title')}</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Author</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer" onclick="window.sortRecords('year')">Year${getSortIcon('year')}</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer" onclick="window.sortRecords('quantity')">Stock${getSortIcon('quantity')}</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                ${currentBooks.map(book => {
        // Highlight special cases
        const isLowStock = book.quantity <= 1;
        const isOldBook = new Date().getFullYear() - book.year > 10;
        const rowClass = isLowStock || isOldBook ? 'bg-red-50/50' : 'hover:bg-gray-50';

        return `
                        <tr class="${rowClass}">
                            <td class="px-4 py-3 text-sm font-medium text-gray-900">${book.title} ${isLowStock ? '<span class="text-red-500 text-xs font-bold">(Low Stock)</span>' : ''} ${isOldBook ? '<span class="text-orange-500 text-xs font-bold">(Old)</span>' : ''}</td>
                            <td class="px-4 py-3 text-sm text-gray-700">${book.author}</td>
                            <td class="px-4 py-3 text-sm text-gray-700">${book.year}</td>
                            <td class="px-4 py-3 text-sm font-bold ${book.quantity === 0 ? 'text-red-600' : 'text-green-600'}">${book.quantity}</td>
                            <td class="px-4 py-3 text-sm text-gray-700">${book.isAvailable ? 'Available' : 'Borrowed'}</td>
                            <td class="px-4 py-3 text-sm space-y-1 sm:space-y-0 sm:space-x-1 flex flex-col sm:flex-row">
                                <button onclick="window.editRecord('${book.id}')" class="text-blue-600 hover:text-blue-900 bg-blue-100 p-1 rounded-md text-xs font-medium">Edit</button>
                                <button onclick="window.promptDelete('${book.id}', '${book.title}')" class="text-red-600 hover:text-red-900 bg-red-100 p-1 rounded-md text-xs font-medium">Delete</button>
                                <button onclick="window.borrowBook('${book.id}')" ${!book.isAvailable ? 'disabled' : ''} class="text-green-600 hover:text-green-900 bg-green-100 p-1 rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">Borrow</button>
                                ${book.borrowers.includes(userId) ? `<button onclick="window.returnBook('${book.id}')" class="text-yellow-600 hover:text-yellow-900 bg-yellow-100 p-1 rounded-md text-xs font-medium">Return</button>` : ''}
                            </td>
                        </tr>
                    `;
    }).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = tableHTML;
}

// Render Card View
function renderCardView(container) {
    const cardsHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            ${currentBooks.map(book => {
        const isLowStock = book.quantity <= 1;
        const isOldBook = new Date().getFullYear() - book.year > 10;
        const cardClass = isLowStock || isOldBook ? 'border-red-500 shadow-xl' : 'border-gray-200 hover:shadow-lg';

        return `
                    <div class="bg-white p-6 rounded-xl border-2 ${cardClass} transition duration-300">
                        <p class="text-xs font-semibold text-gray-500 mb-1">ISBN: ${book.isbn}</p>
                        <h3 class="text-xl font-bold text-gray-900 mb-2">${book.title}</h3>
                        <p class="text-sm text-gray-700 mb-3">by <span class="font-semibold">${book.author}</span> (${book.year})</p>
                        
                        <div class="flex justify-between items-center mb-4">
                            <span class="text-sm font-bold ${book.quantity === 0 ? 'text-red-600' : 'text-green-600'}">Stock: ${book.quantity}</span>
                            <span class="text-xs font-semibold px-3 py-1 rounded-full ${book.isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${book.isAvailable ? 'Available' : 'Borrowed'}</span>
                        </div>

                        ${book.borrowers.length > 0 ? `<p class="text-xs text-gray-500 mb-2">Borrowed by: ${book.borrowers.length} user(s)</p>` : ''}

                        <div class="flex flex-wrap gap-2 mt-4">
                            <button onclick="window.editRecord('${book.id}')" class="flex-1 px-3 py-1 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition">Edit</button>
                            <button onclick="window.promptDelete('${book.id}', '${book.title}')" class="flex-1 px-3 py-1 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition">Delete</button>
                            <button onclick="window.borrowBook('${book.id}')" ${!book.isAvailable ? 'disabled' : ''} class="flex-1 px-3 py-1 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed">Borrow</button>
                            ${book.borrowers.includes(userId) ? `<button onclick="window.returnBook('${book.id}')" class="flex-1 px-3 py-1 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 transition">Return</button>` : ''}
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;
    container.innerHTML = cardsHTML;
}


// Update Summary Section
function updateSummary() {
    const totalBooks = libraryBooks.length;
    const availableBooks = libraryBooks.filter(b => b.isAvailable).length;
    const totalQuantity = libraryBooks.reduce((sum, book) => sum + book.quantity, 0);

    const summaryHTML = `
        <div class="flex flex-wrap justify-between gap-4">
            <div class="p-4 bg-blue-50 rounded-lg shadow-inner flex-1 min-w-[150px]">
                <p class="text-sm text-blue-600 font-medium">Total Unique Titles</p>
                <p class="text-2xl font-bold text-gray-800">${totalBooks}</p>
            </div>
            <div class="p-4 bg-green-50 rounded-lg shadow-inner flex-1 min-w-[150px]">
                <p class="text-sm text-green-600 font-medium">Currently Available</p>
                <p class="text-2xl font-bold text-gray-800">${availableBooks}</p>
            </div>
            <div class="p-4 bg-yellow-50 rounded-lg shadow-inner flex-1 min-w-[150px]">
                <p class="text-sm text-yellow-600 font-medium">Total Stock Quantity</p>
                <p class="text-2xl font-bold text-gray-800">${totalQuantity}</p>
            </div>
            <div class="p-4 bg-red-50 rounded-lg shadow-inner flex-1 min-w-[150px]">
                <p class="text-sm text-red-600 font-medium">Books Borrowed</p>
                <p class="text-2xl font-bold text-gray-800">${totalQuantity - availableBooks}</p>
            </div>
        </div>
    `;
    document.getElementById('summary-section').innerHTML = summaryHTML;
}

// Custom Message/Confirmation Modal (Replacement for alert/confirm)
function displayMessage(message, type = 'info') {
    const toast = document.getElementById('toast-message');
    toast.textContent = message;
    toast.className = `fixed bottom-4 right-4 p-4 rounded-lg shadow-xl text-white z-50 transition-transform duration-500 transform ${type === 'success' ? 'bg-green-500' :
        type === 'error' ? 'bg-red-500' :
            'bg-blue-500'
        }`;
    toast.classList.remove('translate-y-full');
    toast.classList.add('translate-y-0');

    setTimeout(() => {
        toast.classList.add('translate-y-full');
        toast.classList.remove('translate-y-0');
    }, 3000);
}

function showCustomConfirmation(message, onConfirm) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-text').textContent = message;

    document.getElementById('modal-confirm-button').onclick = () => {
        onConfirm();
        modal.classList.add('hidden');
    };

    document.getElementById('modal-cancel-button').onclick = () => {
        modal.classList.add('hidden');
        displayMessage('Action cancelled.', 'info');
    };

    modal.classList.remove('hidden');
}

/**
 * Global Exposure & Initialization
 * Functions called by dynamically generated HTML must be globally accessible.
 */
window.sortRecords = sortRecords;
window.editRecord = editRecord;
window.promptDelete = promptDelete;
window.borrowBook = borrowBook;
window.returnBook = returnBook;

// Attach event listeners to static DOM elements after the content is loaded
document.addEventListener('DOMContentLoaded', () => {
    // 1. Form Submission
    document.getElementById('record-form').addEventListener('submit', saveRecord);

    // 2. Control Inputs
    document.getElementById('search-input').addEventListener('input', applyFiltersAndSort);
    document.getElementById('filter-select').addEventListener('change', applyFiltersAndSort);
    document.getElementById('view-toggle-button').addEventListener('click', toggleView);
    document.getElementById('reset-button').addEventListener('click', resetApp);

    // 3. Initialize Firebase
    initializeFirebase();
});
