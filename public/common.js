// Global variables and constants
let gameOver = false; // Indicates if the game is over
let gameWon = false; // Indicates if the game was won

let correctMovieID = ''; // The ID of the correct movie
let correctMovieObject = ''; // The object containing details of the correct movie
let correctMovieDate = ''; // The date of the correct movie
let formattedMovieDate = ''; // The formatted date of the correct movie

let allMovies = []; // Array to store all movie data
let collectedGuesses = []; // Array to store the user's guesses
let currentMovieListIndex = -1; // Index of the current movie in the movie list
let incorrectGuessCount = 0; // Count of incorrect guesses

let currentReviewIndex = 1; // Index of the current review being displayed
let allReviewJSONs = []; // Array to store all review JSONs
let currentReviewJSONs = []; // Array to store the subset of review JSONs

// Determine if the current movie is an archive movie or today's movie
const pathSegments = window.location.pathname.split('/').filter(Boolean);
let archiveDate = (pathSegments[0] === 'archive' && pathSegments.length > 1)
  ? pathSegments[1]
  : null;

// Initialize Fuse with options
let fuse;
function initializeFuse() {
  const options = {
    keys: ["title"],
    threshold: 0.4, // lower = stricter, higher = fuzzier
    includeScore: true,
  };
  fuse = new Fuse(allMovies, options);
}

// Update the title if archive movie
if (archiveDate) {
  document.title = "Guess The Movie | " + archiveDate;
}

// Global constants for the game
const SKIPPED_GUESS = '__SKIPPED__'; // Sentinel value to indicate a skipped guess
const MAX_NUM_MOVIES_TO_SHOW = 50;
const SELECTED_COLUMNS = ['title', 'year', 'movieID', 'posterLink']; // Columns to select from the CSV file
if (typeof MAX_GUESSES === 'undefined') {
  MAX_GUESSES = 5;
}

// Frequently used DOM elements - cached for performance
const domElements = {
  reviewNumButtons: null,
  shareButton: null,
  dateDisplay: null,
  resultDisplay: null,
  searchInput: null,
  movieList: null,
  reviewCard: null,

  init() {
    this.reviewNumButtons = document.getElementById('imageButtons');
    this.shareButton = document.querySelector('button[id="share-button"]');
    this.dateDisplay = document.getElementById('dateDisplayMessage');
    this.resultDisplay = document.getElementById('resultDisplay');
    this.searchInput = document.getElementById('search');
    this.movieList = document.getElementById('movieList');
    this.reviewCard = document.getElementById('reviewCard');
  },

  get(elementName) {
    if (!this[elementName]) {
      switch (elementName) {
        case 'searchInput': this.searchInput = document.getElementById('search'); break;
        case 'movieList': this.movieList = document.getElementById('movieList'); break;
        case 'reviewCard': this.reviewCard = document.getElementById('reviewCard'); break;
        default: break;
      }
    }
    return this[elementName];
  }
};

// Legacy constants for backward compatibility - will be set after DOM is ready
let reviewNumButtons, shareButton, dateDisplay, resultDisplay;

migrateLocalStorage();

// Cache localStorage data to avoid repeated parsing
class GameDataCache {
  constructor() {
    this._gameStats = null;
    this._gameHistory = null;
  }

  get gameStats() {
    if (!this._gameStats) {
      this._gameStats = JSON.parse(localStorage.getItem('gameStats')) || {
        gamesFinished: 0,
        gamesWon: 0,
        gamesLost: 0,
        fastestWin: null,
        slowestWin: null,
        averageGuesses: null,
        winPercentage: 0
      };
    }
    return this._gameStats;
  }

  get gameHistory() {
    if (!this._gameHistory) {
      this._gameHistory = JSON.parse(localStorage.getItem('gameHistory')) || [];
    }
    return this._gameHistory;
  }

  saveGameStats(stats) {
    this._gameStats = stats;
    localStorage.setItem('gameStats', JSON.stringify(stats));
  }

  saveGameHistory(history) {
    this._gameHistory = history;
    localStorage.setItem('gameHistory', JSON.stringify(history));
  }

  invalidateCache() {
    this._gameStats = null;
    this._gameHistory = null;
  }
}

const gameCache = new GameDataCache();
let globalGameStats = gameCache.gameStats;
let globalGameHistory = gameCache.gameHistory;
let ongoingGame = null;

function loadOngoingGame(correctMovieID, correctMovieDate) {
  let game = globalGameHistory.find(g => g.id === correctMovieID && g.status === 'incomplete');
  if (game) {
    ongoingGame = { ...game };
    collectedGuesses = [...(game.guesses || [])];
    incorrectGuessCount = collectedGuesses.length;
    return true;
  }
  return false;
}

function startOngoingGame(correctMovieID, correctMovieDate) {
  if (!ongoingGame) {
    ongoingGame = {
      id: correctMovieID,
      date: correctMovieDate,
      status: 'incomplete',
      guesses: [],
      timeStarted: null,
      timeCompleted: null
    };
    globalGameHistory.push(ongoingGame);
    saveGameHistory();
  }
}

function saveGameHistory() {
  gameCache.saveGameHistory(globalGameHistory);
}

function updateOngoingGameOnGuess(guess, isSkip = false) {
  if (!ongoingGame) return;
  if (!ongoingGame.timeStarted) ongoingGame.timeStarted = new Date().toISOString();
  ongoingGame.guesses.push(guess);
  saveGameHistory();
}

function finishOngoingGame(status) {
  if (!ongoingGame) return;
  ongoingGame.status = status;
  ongoingGame.timeCompleted = new Date().toISOString();

  // Store movie details for future reference
  if (correctMovieObject) {
    ongoingGame.title = correctMovieObject.title;
    ongoingGame.year = correctMovieObject.year;
    ongoingGame.posterLink = correctMovieObject.posterLink;
  }

  // Find and update the corresponding game in globalGameHistory
  const idx = globalGameHistory.findIndex(g => g.id === ongoingGame.id && g.status === 'incomplete');
  if (idx !== -1) {
    globalGameHistory[idx] = { ...ongoingGame };
  }

  saveGameHistory();
  updateGameStats();
  ongoingGame = null;
}

function updateGameStats() {
  const history = gameCache.gameHistory;
  const finishedGames = history.filter(g => g.status === 'won' || g.status === 'lost');
  const gamesFinished = finishedGames.length;
  const gamesWon = finishedGames.filter(g => g.status === 'won').length;
  const gamesLost = finishedGames.filter(g => g.status === 'lost').length;
  const winGames = finishedGames.filter(g => g.status === 'won');

  const stats = {
    gamesFinished,
    gamesWon,
    gamesLost,
    fastestWin: winGames.length ? Math.min(...winGames.map(g => g.guesses.length)) : null,
    slowestWin: winGames.length ? Math.max(...winGames.map(g => g.guesses.length)) : null,
    averageGuesses: gamesFinished ? (finishedGames.reduce((acc, g) => acc + (g.guesses.length || 0), 0) / gamesFinished) : null,
    winPercentage: gamesFinished ? Math.round((gamesWon / gamesFinished) * 100) : 0
  };

  gameCache.saveGameStats(stats);
  globalGameStats = stats;
}

// v1: Checks whether the user has played the current game
function hasGameBeenPlayed(correctMovieID) {
  return gameCache.gameHistory.some(game =>
    game.id === correctMovieID && (game.status === 'won' || game.status === 'lost')
  );
}

// Formats previous guesses for display in incomplete games
function formatPreviousGuesses(guesses) {
  if (!guesses || guesses.length === 0) {
    return [];
  }

  let guessItems = [];

  for (let i = 0; i < guesses.length; i++) {
    if (guesses[i] === SKIPPED_GUESS) {
      guessItems.push({
        text: 'Skipped',
        reviewIndex: i + 1,
        isCorrect: false
      });
    } else {
      // Check if this guess is the correct movie
      const isCorrect = guesses[i] === correctMovieID;

      // Find the movie object for this guess
      let movie = allMovies.find(m => m.movieID === guesses[i]);

      if (movie) {
        guessItems.push({
          text: `${movie.title} (${movie.year})`,
          reviewIndex: i + 1,
          isCorrect: isCorrect
        });
      } else {

        // For completed games, try to look up the movie info from game history
        // This handles the case where the game was completed and we stored movie details
        const history = gameCache.gameHistory;
        const foundMovieInfo = history.find(game =>
          game.id === guesses[i] && game.title && game.year
        );

        if (foundMovieInfo) {
          guessItems.push({
            text: `${foundMovieInfo.title} (${foundMovieInfo.year})`,
            reviewIndex: i + 1,
            isCorrect: isCorrect
          });
        } else {
          // Final fallback - just show the movieID (this should rarely happen)
          guessItems.push({
            text: `Movie ID: ${guesses[i]}`,
            reviewIndex: i + 1,
            isCorrect: isCorrect
          });
        }
      }
    }
  }

  return guessItems;
}

// v1: Checks if user won the current game
function hasGameBeenWon(correctMovieID) {
  return gameCache.gameHistory.some(game =>
    game.id === correctMovieID && game.status === 'won'
  );
}

// Update game based on the movie the user selected
function selectMovie(guessedMovieID) {
  const guessedMovie = allMovies.find(movie => movie.movieID === guessedMovieID);
  const isCorrectMovie = guessedMovieID === correctMovieID;

  startOngoingGame(correctMovieID, correctMovieDate);

  if (isCorrectMovie) {
    collectedGuesses.push(guessedMovie.movieID);
    updateOngoingGameOnGuess(guessedMovie.movieID);
    finishGame(true);
  } else {
    handleGuess(guessedMovie);
  }
}

// Load movie into search bar without submitting
function loadMovieIntoSearchBar(movieID) {
  const movie = allMovies.find(m => m.movieID === movieID);
  if (movie) {
    const searchInput = domElements.get('searchInput');
    if (searchInput) {
      searchInput.value = `${movie.title} (${movie.year})`;
      clearMovieList();
    }
  }
}

// Handle submit button click
function handleSubmit() {
  const searchInput = domElements.get('searchInput');
  if (!searchInput) return;

  const searchQuery = searchInput.value.trim();

  if (searchQuery === '') {
    handleGuess(null);
    return;
  }

  // Check for exact match first (most common case)
  const exactMatch = allMovies.find(movie =>
    `${movie.title} (${movie.year})` === searchQuery
  );

  if (exactMatch) {
    selectMovie(exactMatch.movieID);
    return;
  }

  // Search for movies using Fuse or fallback
  const filteredMovies = searchMovies(searchQuery);

  if (filteredMovies.length > 0) {
    const firstMovie = filteredMovies[0];
    searchInput.value = `${firstMovie.title} (${firstMovie.year})`;
    clearMovieList();
    selectMovie(firstMovie.movieID);
  } else {
    handleGuess(null);
  }
}

// Extracted search logic for reusability
function searchMovies(query) {
  if (fuse) {
    return fuse.search(query)
      .slice(0, MAX_NUM_MOVIES_TO_SHOW)
      .map(result => result.item);
  }

  // Fallback search
  const lowerQuery = query.toLowerCase();
  return allMovies.filter(movie =>
    movie.title && movie.title.toLowerCase().includes(lowerQuery)
  ).slice(0, MAX_NUM_MOVIES_TO_SHOW);
}

// Finish the game
function finishGame(wonGame) {
  gameOver = true;
  gameWon = wonGame;
  gameOverMessage = wonGame ? "You got it! " : "You lost. ";
  if (resultDisplay) {
    resultDisplay.innerHTML = `${gameOverMessage}<span class="message"></span><a>${correctMovieObject.title} (${correctMovieObject.year})</a><span class="message"> is the correct movie.</span><br>`;
    const comeBackText = document.getElementById('come-back-text');
    if (comeBackText) {
      comeBackText.textContent = "Come back tomorrow for a new movie or use the archive to play past movies!";
    }
  }

  // Update the past guesses accordion for finished games
  const previousGuessesItems = formatPreviousGuesses(collectedGuesses);
  updatePastGuessesDisplay(previousGuessesItems);

  toggleAccordion(false);

  clearSearchAndMovieList();
  // Always show all reviews when game ends, regardless of win/loss
  currentReviewJSONs = allReviewJSONs.slice(0, MAX_GUESSES);
  updateReviewNumButtons();

  if (reviewNumButtons) {
    reviewNumButtons.style.marginRight = "0px";
  }
  const searchElem = document.getElementById('search');
  if (searchElem) searchElem.remove();

  // Add movie poster to page
  const img = document.createElement('img');
  img.src = correctMovieObject.posterLink;
  img.alt = `${correctMovieObject.title} (${correctMovieObject.year}) movie poster`;
  const existingDiv = document.getElementById('movie_poster');
  if (existingDiv) {
    existingDiv.innerHTML = '';
    existingDiv.appendChild(img);
  } else {
    console.error('Movie poster div with id movie_poster not found');
  }
  if (existingDiv) {
    existingDiv.setAttribute("href", "https://letterboxd.com/film/" + correctMovieID);
    existingDiv.setAttribute("target", "_blank");
  }
  const searchRow = document.getElementById('search-row');
  if (searchRow) {
    searchRow.remove();
  }

  // Show the share button now that the game is over
  if (shareButton) {
    shareButton.style.display = 'inline-block';
  }
  if (reviewNumButtons) {
    reviewNumButtons.style.marginRight = '5px';
  }

  // v1: Set and update gameHistory and stats only when game is finished
  if (ongoingGame) {
    let status = (incorrectGuessCount < MAX_GUESSES) ? 'won' : 'lost';
    finishOngoingGame(status);
  }

  // Reveal the static affiliate container (if present) and update its content/link
  try {
    const aff = document.getElementById('affiliate-offers');
    if (aff) {
      // Build the affiliate links dynamically using affiliates/services.json
      (async function() {
        const movieTitle = (correctMovieObject && correctMovieObject.title) ? correctMovieObject.title : '';

        // Try to load services definitions (title + icon info)
        // Default services (safe fallback without network). These will be used
        // when the JSON isn't available or fetch fails. Keep minimal defaults
        // so affiliate rendering still works.
        let services = {
          "amazon-dvd": {
            "id": "amazon-dvd",
            "title": "Amazon (DVD)",
            "icon": { "type": "svg", "value": "/images/amazon.svg", "alt": "Amazon logo" }
          },
          "prime-video": {
            "id": "prime-video",
            "title": "Prime Video (Rent/Buy)",
            "icon": { "type": "svg", "value": "/images/prime-video.svg", "alt": "Prime Video logo" }
          }
        };

        // Attempt to fetch an external services.json placed under affiliates/.
        // Use a URL relative to the current page so this works whether the site
        // is hosted at root or under a subpath (GitHub Pages, Cloudflare Pages, etc).
        try {
          const servicesUrl = new URL('affiliates/services.json', window.location.href).href;
          const res = await fetch(servicesUrl, { cache: 'no-cache' });
          if (res.ok) {
            const fetched = await res.json();
            // merge fetched keys over defaults
            services = Object.assign({}, services, fetched);
          }
        } catch (e) {
          // silent fallback to defaults (avoid noisy console errors)
        }

        // If the movie JSON contains explicit affiliate links, prefer those
        const movieAffiliates = (correctMovieObject && correctMovieObject.affiliate_links) ? correctMovieObject.affiliate_links : null;

        // Helper to build link HTML for a given service id and href
        const buildLinkHtml = (id, href) => {
          const svc = services[id] || {};
          const title = svc.title || (id === 'amazon-dvd' ? 'Amazon / DVD' : (id === 'prime-video' ? 'Prime Video — Buy / Rent' : id));

          // Build icon HTML
          let iconHtml = '';
          if (svc.icon) {
            if (svc.icon.type === 'svg' && svc.icon.value) {
              const src = svc.icon.value.replace(/^public\//, '/');
              iconHtml = `<img class="icon" src="${src}" alt="${(svc.icon.alt || title)}" />`;
            } else if (svc.icon.type === 'fa' && svc.icon.value) {
              iconHtml = `<i class="${svc.icon.value} icon" aria-hidden="true"></i>`;
            }
          }
          if (!iconHtml) {
            if (id === 'amazon-dvd') iconHtml = '<i class="fa-brands fa-amazon icon" aria-hidden="true"></i>';
            else iconHtml = '<i class="fa-solid fa-play icon" aria-hidden="true"></i>';
          }

          const aria = `aria-label="${title} (opens in new tab)"`;
          return `<a class="where-link" href="${href}" target="_blank" rel="sponsored noopener noreferrer" ${aria}>${iconHtml}<span>${title}</span></a>`;
        };

        let whereLinksHtml = '';

        if (movieAffiliates && Object.keys(movieAffiliates).length > 0) {
          // Preserve a sensible order if possible, otherwise use keys as-is
          const desiredOrder = ['amazon-dvd', 'prime-video'];
          const keys = Object.keys(movieAffiliates);
          // Order keys: those in desiredOrder first (in that order), then others
          const ordered = [...desiredOrder.filter(k => keys.includes(k)), ...keys.filter(k => !desiredOrder.includes(k))];

          whereLinksHtml = ordered.map(id => {
            const href = movieAffiliates[id] || movieAffiliates[id.toLowerCase()] || movieAffiliates[id.replace('_', '-')] || '';
            if (!href) return '';
            return buildLinkHtml(id, href);
          }).filter(Boolean).join('');
        }

        const inner = aff.querySelector('.affiliate-inner');
        // Only render the affiliate block if we have at least one movie-provided link
        if (whereLinksHtml && whereLinksHtml.trim().length > 0) {
          if (inner) {
            inner.innerHTML = `
              <div class="where-heading">Where to watch</div>
              <div class="where-links">
                ${whereLinksHtml}
              </div>
            `;
          }
          aff.classList.add('visible');
          aff.setAttribute('aria-hidden', 'false');
        } else {
          // Ensure the affiliate container is hidden when there are no movie-specific links
          if (inner) inner.innerHTML = '';
          aff.classList.remove('visible');
          aff.setAttribute('aria-hidden', 'true');
        }
      })();
    }
  } catch (e) {
    console.error('Failed to update affiliate container:', e);
  }

  displayCurrentReview(currentReviewIndex);
}

// Handles the user's guess or skip
function handleGuess(guess) {
  toggleAccordion(true);
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  setTimeout(() => window.scrollTo({
    top: 0,
    left: 0,
    behavior: 'smooth'
  }), 100);

  startOngoingGame(correctMovieID, correctMovieDate);

  if (guess !== null) {
    collectedGuesses.push(guess.movieID);
    updateOngoingGameOnGuess(guess.movieID);
  } else {
    collectedGuesses.push(SKIPPED_GUESS);
    updateOngoingGameOnGuess(SKIPPED_GUESS, true);
  }

  incorrectGuessCount++;

  // Calculate remaining guesses and format previous guesses
  const remainingGuesses = MAX_GUESSES - incorrectGuessCount;
  const guessString = remainingGuesses === 1 ? "1 Guess" : `${remainingGuesses} Guesses`;
  const previousGuessesItems = formatPreviousGuesses(collectedGuesses);

  // Display simple progress message
  if (resultDisplay) {
    resultDisplay.innerHTML = `<div class="remaining-guesses">${guessString} Left</div>`;
  }

  // Update the past guesses accordion
  updatePastGuessesDisplay(previousGuessesItems);

  clearSearchAndMovieList();
  if (incorrectGuessCount < MAX_GUESSES) {
    currentReviewJSONs = allReviewJSONs.slice(0, incorrectGuessCount + 1);
    updateReviewNumButtons();
    displayCurrentReview(incorrectGuessCount + 1);
  } else {
    finishGame(false);
  }
}

// Handles sharing
function pressShare() {
  let shareText = ''
  // Sets share text
  if (gameWon) {
    if (collectedGuesses.length === 1) {
      shareText = `I played "Guess The Movie" and got it in 1 guess! Can you do better?`;
    } else {
      shareText = `I played "Guess The Movie" and got it in ${collectedGuesses.length} guesses! Can you do better?`;
    }
  } else {
    shareText = `I played "Guess The Movie" but wasn't able to get it. Can you?`;
  }

  // Put the text first and append the URL so most share targets display the message first
  const fullShareText = `${shareText} Play now at ${window.location.href}`;

  // Prefer the native Share API with a text-only payload (omit `url` so platforms don't prioritize the link)
  if (navigator.share) {
    navigator.share({ text: fullShareText })
      .catch(() => {
        // If sharing fails, fallback to copying to clipboard
        navigator.clipboard.writeText(fullShareText)
          .then(() => {
            if (shareButton) {
              shareButton.textContent = "Copied";
              setTimeout(() => { shareButton.textContent = "Share"; }, 4000);
            }
          })
          .catch((err) => {
            console.error("Failed to copy text: ", err);
          });
      });
    return;
  }

  // Fallback: copy the combined text to the clipboard
  navigator.clipboard.writeText(fullShareText)
    .then(() => {
      if (shareButton) {
        shareButton.textContent = "Copied";
        setTimeout(() => {
          shareButton.textContent = "Share";
        }, 4000);
      }
    })
    .catch((err) => {
      console.error("Failed to copy text: ", err);
    });
}

// Clear the search input and movie list
function clearSearchAndMovieList() {
  const searchInput = domElements.get('searchInput');
  const movieList = domElements.get('movieList');

  if (searchInput) searchInput.value = '';
  if (movieList) movieList.innerHTML = '';
}

// Clear only the movie list
function clearMovieList() {
  const movieList = domElements.get('movieList');
  if (movieList) movieList.innerHTML = '';
}

// Fetch all movie data for a given date (now fetches single consolidated JSON file)
async function fetchMovieData(date) {
  try {
    const response = await fetch(`/movies/${date}.json`);
    if (!response.ok) {
      console.error(`Movie data not found for ${date}`);
      return null;
    }
    const data = await response.json();
    
    // Populate allReviewJSONs with all reviews
    allReviewJSONs = data.reviews || [];
    
    // Set the first review as current
    if (allReviewJSONs.length > 0) {
      currentReviewJSONs = [allReviewJSONs[0]];
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching movie data:', error);
    return null;
  }
}

// Legacy function for compatibility - now just returns review from allReviewJSONs
async function fetchData(movieID, date, index) {
  // This function is kept for compatibility but data is now loaded via fetchMovieData
  // Reviews are already in allReviewJSONs array
  return;
}

// Display the current review based on the review index
function displayCurrentReview(index = 1) {

  const review = currentReviewJSONs[index - 1];
  const reviewCard = document.getElementById('reviewCard');
  if (!review || currentReviewJSONs.length === 0) {
    reviewCard.style.display = 'none';
    return;
  }
  reviewCard.style.display = 'block';

  // Profile photo
  const profileImg = document.getElementById('reviewProfilePhoto');
  profileImg.src = review.profilePhotoLink;
  profileImg.alt = `${review.username}'s profile photo`;

  // Username
  document.getElementById('reviewUsername').textContent = review.username;

  // Date
  document.getElementById('reviewDate').textContent = review.date;

  // Rating
  const ratingContainer = document.getElementById('reviewRating');
  ratingContainer.innerHTML = '';
  if (review.rating !== '') {
    const ratingDecimal = parseFloat(review.rating);
    for (let i = 0; i < 5; i++) {
      let star = document.createElement('i');
      if (i < Math.floor(ratingDecimal)) {
        star.classList.add('fa-solid', 'fa-star', 'star', 'icon');
      } else if (i < ratingDecimal) {
        star.classList.add('fa-solid', 'fa-star-half-stroke', 'star', 'icon');
      } else {
        star.classList.add('fa-regular', 'fa-star', 'star', 'icon');
      }
      ratingContainer.appendChild(star);
    }
  }

  // Liked
  const likedIcon = document.getElementById('reviewLiked');
  likedIcon.style.display = review.liked ? 'inline-block' : 'none';

  // Review text
  if (review.collapsed) {
    document.getElementById('reviewText').innerHTML = review.text + '<p class="truncated-label">Review Truncated</p>';
  }
  else {
    document.getElementById('reviewText').innerHTML = review.text;
  }

  // Number of likes and comments
  document.getElementById('likesCount').textContent = Number(review.numLikes).toLocaleString();
  document.getElementById('commentsCount').textContent = Number(review.num_comments).toLocaleString();

  // Link: Only show if game is over
  const reviewLink = document.getElementById('reviewLink');
  if (gameOver) {
    reviewLink.href = review.link;
    reviewLink.style.display = 'inline-block';
  } else {
    reviewLink.style.display = 'none';
  }
}

// Make review number button active 
function makeButtonActive(index) {
  if (!reviewNumButtons) return;

  const buttons = reviewNumButtons.querySelectorAll('button');
  buttons.forEach(button => {
    if (parseInt(button.textContent) === index) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
      button.blur()
    }
  });
}

// Update the review number buttons based on the current review JSONs
function updateReviewNumButtons() {
  if (!reviewNumButtons) return;

  reviewNumButtons.innerHTML = '';
  currentReviewJSONs.forEach((review, index) => {
    const button = document.createElement('button');
    button.textContent = index + 1;
    button.onclick = () => {
      let numReview = parseInt(button.textContent, 10)
      displayCurrentReview(numReview);
      makeButtonActive(numReview);
      currentReviewIndex = parseInt(numReview);
    };
    reviewNumButtons.appendChild(button);
  });

  // When game is over, ensure currentReviewIndex is valid for available reviews
  if (gameOver) {
    const validIndex = Math.min(currentReviewIndex, currentReviewJSONs.length);
    makeButtonActive(validIndex);
    currentReviewIndex = validIndex;
  } else {
    makeButtonActive(incorrectGuessCount + 1);
    currentReviewIndex = incorrectGuessCount + 1;
  }
}

// Updates the selected movie for styling
function updateSelectedItem() {
  const items = document.querySelectorAll('.movie-list li');
  items.forEach((item, index) => {
    if (index === currentMovieListIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Adds mouse listeners to the movie list items so hover and click events select the movie
function addMouseListeners() {
  const items = document.querySelectorAll('.movie-list li');
  items.forEach((item, index) => {
    item.addEventListener('mousemove', () => {
      currentMovieListIndex = index;
      updateSelectedItem();
    });
    item.addEventListener('click', () => {
      currentMovieListIndex = index;
      updateSelectedItem();
    });
  });
}

// Keydown listener for keyboard navigation (up/down for movie selection, enter for movie submission, left/right for review navigation)
window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    const items = document.querySelectorAll('.movie-list li');
    if (items.length === 0) return;
    const activeElement = document.activeElement;

    event.preventDefault();
    // If the search textbox is focused, select the first movie
    if (activeElement.id === 'search' && currentMovieListIndex == -1) {
      currentMovieListIndex = 0;
    } else {
      // Otherwise, move to the next item (with wrapping)
      if (currentMovieListIndex < items.length - 1) {
        currentMovieListIndex++;
      }
    }
    updateSelectedItem();
  }

  else if (event.key === 'ArrowUp') {
    const items = document.querySelectorAll('.movie-list li');
    if (items.length === 0) return;
    const activeElement = document.activeElement;

    event.preventDefault();
    // Only change index if the search box is not focused
    if (currentMovieListIndex > 0) {
      currentMovieListIndex--;
    }
    updateSelectedItem();
  }
  else if (event.key === 'Enter') {
    const items = document.querySelectorAll('.movie-list li');
    const activeElement = document.activeElement;

    // If Enter is pressed while search input is focused and no movie is selected from list
    if (activeElement.id === 'search' && currentMovieListIndex === -1) {
      // Submit the current search query
      handleSubmit();
      return;
    }

    // If there are movies in the list
    if (items.length > 0) {
      // If the search textbox is focused and no movie is selected, select the first movie
      if (activeElement.id === 'search' && currentMovieListIndex === -1) {
        currentMovieListIndex = 0;
        updateSelectedItem();
      }
      // Load the selected movie into search bar if valid
      else if (currentMovieListIndex >= 0 && currentMovieListIndex < items.length) {
        items[currentMovieListIndex].click();
      }
    }
  }
  else if (event.key === 'ArrowRight') {
    if (currentReviewIndex < currentReviewJSONs.length) {
      displayCurrentReview(currentReviewIndex + 1);
      makeButtonActive(currentReviewIndex + 1);
      currentReviewIndex = currentReviewIndex + 1;
    }
  }
  else if (event.key === 'ArrowLeft') {
    if (currentReviewIndex > 1) {
      displayCurrentReview(currentReviewIndex - 1);
      makeButtonActive(currentReviewIndex - 1);
      currentReviewIndex = currentReviewIndex - 1;
    }
  }
});

// Display the updated movie list 
function displayMovieList(movies) {
  const movieListElement = domElements.get('movieList');
  if (!movieListElement) return;

  // Use document fragment for better performance
  const fragment = document.createDocumentFragment();

  movies.slice(0, MAX_NUM_MOVIES_TO_SHOW).forEach(movie => {
    const listItem = document.createElement('li');
    listItem.textContent = `${movie.title} (${movie.year})`;
    listItem.onclick = () => loadMovieIntoSearchBar(movie.movieID);
    fragment.appendChild(listItem);
  });

  movieListElement.innerHTML = '';
  movieListElement.appendChild(fragment);

  // Reset the selection index on list update and add mouse listeners
  currentMovieListIndex = -1;
  addMouseListeners();
}


function filterMovies(event) {
  const searchInput = domElements.get('searchInput');
  if (!searchInput) return;

  // Only process valid characters
  const allowedRegex = /^[a-zA-Z0-9 !@#$ﬂ&*()_+\-=\~`{}|:"<>?$$\\;',./]$/;
  if (event.key !== undefined && event.key !== "Backspace" && !allowedRegex.test(event.key)) {
    return;
  }

  const searchQuery = searchInput.value.trim();

  if (searchQuery === "") {
    clearSearchAndMovieList();
    return;
  }

  const filteredMovies = searchMovies(searchQuery);
  displayMovieList(filteredMovies);
}

document.addEventListener('DOMContentLoaded', async function initializeGame() {
  try {
    // Initialize DOM elements cache
    domElements.init();

    // Set legacy constants after DOM is ready
    reviewNumButtons = domElements.reviewNumButtons;
    shareButton = domElements.shareButton;
    dateDisplay = domElements.dateDisplay;
    resultDisplay = domElements.resultDisplay;
    const csvResponse = await fetch('/movies.csv');
    const csvText = await csvResponse.text();

    Papa.parse(csvText, {
      header: true,
      complete: results => {
        allMovies = results.data
          .map(row => {
            let selectedRow = {};
            SELECTED_COLUMNS.forEach(col => {
              selectedRow[col] = row[col];
            });
            return selectedRow;
          })
          .filter(row =>
            Object.values(row).every(value => value !== undefined && value !== null && value !== "")
          );
      }
    });
    initializeFuse();

    // Fetch dates manifest to get latest date
    const datesResponse = await fetch('/dates.json');
    if (!datesResponse.ok) throw new Error('Could not load dates manifest');
    const datesData = await datesResponse.json();
    
    // Determine which date to use
    const targetDate = archiveDate || datesData.latestDate;
    
    // Fetch movie data for the target date
    const movieData = await fetchMovieData(targetDate);
    if (!movieData) throw new Error(`No movie data found for ${targetDate}`);

    correctMovieID = movieData.movieID;
    correctMovieDate = movieData.date;
    formattedMovieDate = new Date(correctMovieDate).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Try to get correctMovieObject from localStorage game history if available
    const gameObj = gameCache.gameHistory.find(g => g.id === correctMovieID);
    if (gameObj && gameObj.title && gameObj.year && gameObj.posterLink) {
      correctMovieObject = {
        title: gameObj.title,
        year: gameObj.year,
        posterLink: gameObj.posterLink,
        movieID: correctMovieID
      };
    } else {
      correctMovieObject = allMovies.find(movie => movie.movieID === correctMovieID);
    }

    // If movie JSON contains affiliate links, attach them to correctMovieObject so finishGame can use them
    if (movieData && movieData.affiliate_links && Object.keys(movieData.affiliate_links).length > 0) {
      if (!correctMovieObject) correctMovieObject = {};
      correctMovieObject.affiliate_links = movieData.affiliate_links;
    }

    // Reviews are already loaded via fetchMovieData, no need to fetch individually
    // The old fetchData loop is no longer needed

    let game_in_progress = loadOngoingGame(correctMovieID, correctMovieDate);

    // Game was lost or won (completed)
    if (hasGameBeenPlayed(correctMovieID)) {
      // Load the completed game data to populate collectedGuesses and incorrectGuessCount
      const completedGame = gameCache.gameHistory.find(g =>
        g.id === correctMovieID && (g.status === 'won' || g.status === 'lost')
      );
      if (completedGame && completedGame.guesses) {
        collectedGuesses = [...completedGame.guesses];
        incorrectGuessCount = completedGame.guesses.length;
      }
      finishGame(hasGameBeenWon(correctMovieID));
    }
    // Game was attempted but not completed
    else if (game_in_progress) {
      incorrectGuessCount = ongoingGame.guesses.length;
      collectedGuesses = [...ongoingGame.guesses];

      // Calculate remaining guesses
      const remainingGuesses = MAX_GUESSES - incorrectGuessCount;
      const guessString = remainingGuesses === 1 ? "1 Guess" : `${remainingGuesses} Guesses`;

      // Format previous guesses
      const previousGuessesItems = formatPreviousGuesses(collectedGuesses);

      // Display simple progress message
      if (resultDisplay) {
        resultDisplay.innerHTML = `<div class="remaining-guesses">${guessString} Left</div>`;
      }

      // Update the past guesses accordion
      updatePastGuessesDisplay(previousGuessesItems);

      currentReviewJSONs = allReviewJSONs.slice(0, incorrectGuessCount + 1);
      updateReviewNumButtons();
      // Show the last review the user unlocked, not always the first
      if (incorrectGuessCount > 0) {
        displayCurrentReview(incorrectGuessCount + 1);
      } else {
        displayCurrentReview();
      }

      if (shareButton) {
        shareButton.style.display = 'none';
      }
    }
    // New game
    else {
      // Show remaining guesses for new games
      const guessString = MAX_GUESSES === 1 ? "1 Guess" : `${MAX_GUESSES} Guesses`;
      if (resultDisplay) {
        resultDisplay.innerHTML = `<div class="remaining-guesses">${guessString} Left</div>`;
      }

      updateReviewNumButtons();
      displayCurrentReview();

      // Hide share button for new games
      if (shareButton) {
        shareButton.style.display = 'none';
      }

    }

    if (dateDisplay) {
      if (archiveDate) {
        dateDisplay.textContent = `Archive (${formattedMovieDate})`;
      } else {
        dateDisplay.textContent = `Today's movie (${formattedMovieDate})`;
      }
    }

  }
  catch (error) {
    console.error('Error during initialization:', error);
  }
});

// Past Guesses Accordion Functions
function toggleAccordion(forceState) {
  const container = document.querySelector('.accordion-container');
  const content = document.querySelector('.accordion-content');
  const expandText = document.querySelector('.expand-minimize-text');

  if (!container || !content) return;

  if (typeof forceState === 'boolean') {
    if (forceState) {
      container.classList.add('open');
      if (expandText) expandText.textContent = 'Click to minimize';
    } else {
      container.classList.remove('open');
      if (expandText) expandText.textContent = 'Click to expand';
    }
  } else {
    container.classList.toggle('open');
    if (expandText) {
      if (container.classList.contains('open')) {
        expandText.textContent = 'Click to minimize';
      } else {
        expandText.textContent = 'Click to expand';
      }
    }
  }
}

function updatePastGuessesDisplay(guesses) {
  const container = document.getElementById('past-guesses-display');
  const guessCountBadge = document.querySelector('.guess-count-badge');
  const content = document.querySelector('.accordion-content');

  if (!container || !guessCountBadge || !content) {
    return;
  }

  // Show/hide the container based on whether there are guesses
  if (!guesses || guesses.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';    // Update the header title and badge count
  guessCountBadge.textContent = guesses.length;

  // Add winning class if game was won
  if (gameWon) {
    container.classList.add('won');
    container.classList.remove('lost');
  } else {
    container.classList.remove('won');
    container.classList.add('lost');
  }

  // Populate the accordion content
  populateAccordionContent(guesses);
}

function populateAccordionContent(guesses) {
  const content = document.querySelector('.accordion-content');
  if (!content) return;

  content.innerHTML = '';

  // Create a horizontal container for the guesses
  const horizontalContainer = document.createElement('div');
  horizontalContainer.className = 'guess-horizontal-container';
  // Set a CSS variable for the number of guesses (for spacing)
  horizontalContainer.style.setProperty('--guess-count', guesses.length);

  guesses.forEach((guess, index) => {
    const item = document.createElement('div');
    item.className = 'guess-item-horizontal';

    const isSkipped = guess.text === 'Skipped';
    const titleClass = isSkipped ? 'guess-title skipped' : 'guess-title';
    const numberClass = guess.isCorrect ? 'guess-number correct' : 'guess-number';

    // Try to get posterLink from allMovies or game history
    let posterLink = '';
    let movieID = '';
    let title = '';
    let year = '';
    if (!isSkipped) {
      // Extract movieID from guess.text if possible
      const match = guess.text.match(/\((\d{4})\)$/);
      if (match) {
        // Try to find the movie in allMovies
        const found = allMovies.find(m => `${m.title} (${m.year})` === guess.text);
        if (found) {
          posterLink = found.posterLink;
          movieID = found.movieID;
          title = found.title;
          year = found.year;
        } else {
          // Try to find in game history
          const foundHistory = (gameCache && gameCache.gameHistory) ? gameCache.gameHistory.find(g => `${g.title} (${g.year})` === guess.text) : null;
          if (foundHistory) {
            posterLink = foundHistory.posterLink;
            movieID = foundHistory.movieID;
            title = foundHistory.title;
            year = foundHistory.year;
          }
        }
      }
    }

    item.innerHTML = `
      <div class="${numberClass}">${index + 1}</div>
      <div class="guess-poster-container">
        ${posterLink ? `<img class="guess-poster" src="${posterLink}" alt="${title} (${year}) poster">` : `<div class="guess-poster-placeholder">?</div>`}
      </div>
      <div class="guess-content-horizontal">
        <div class="${titleClass}">${guess.text}</div>
      </div>
    `;

    horizontalContainer.appendChild(item);
  });

  content.appendChild(horizontalContainer);
}