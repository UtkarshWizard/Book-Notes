import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import axios from "axios";

const app = express();
const port = 3000;

const { Pool } = pg;

const connectionString = "postgres://book_nzj2_user:0eZIJYvx5LVy1ye8Rr1x4DTrasHNS9m8@dpg-cns66ca0si5c73c2dujg-a.singapore-postgres.render.com/book_nzj2";//you can create your postgreSQL server on render.com or Vercel and then they'll give u external URL copy that and paste it here

const db = new Pool({
  connectionString: connectionString, //your External Database URL,you'll find it inside the onrender postgres server dashboard 
  ssl: {
    rejectUnauthorized: false,
  },
});

db.connect();

const url = "https://openlibrary.org/search.json";

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

//Route to render the home page.
app.get("/", async (req, res) => {
  try {
    let sortBy = req.query.sort   //Default sorting by name
    console.log(sortBy);
    let query;
    
    if (sortBy === "recent") {
      query = "SELECT * FROM book ORDER BY id DESC";
    } else if (sortBy === "name") {
      query = "SELECT * FROM book ORDER BY bookname ASC"
    } 
    else {
      query = "SELECT * FROM book";  
    }
    const result = await db.query(query);
    const data = result.rows;
    console.log(data);
    res.render("index.ejs", { data });
  } catch (error) {
    res.status(404).send(error.message);
  }
});

//Route to render the Add Book page.
app.get("/add", async (req, res) => {
  res.render("add.ejs");
});

//Route to Handle search bar operations on add book page.
app.post("/search-book", async (req, res) => {
  const searchBook = req.body.searchbar;
  let Errmessage = "";

  try {
    const { bookTitle, bookAuthor, coverId } = await fetchData(searchBook);
    console.log("Searched Book: ", bookTitle);
    console.log("Cover Id: ", coverId); //Displays information of book and fetch it from api.
    console.log("Book Author: ", bookAuthor);

    //function to fetch data from api.
    async function fetchData(searchBook) {
      try {
        const response = await fetch(url + `?q=${searchBook}&limit=1`);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        //console.log(data);
        const result = data.docs;
        const bookTitle = result.map((book) => book.title);
        const bookAuthor = result.map((book) =>
          book.author_name ? book.author_name[0] : "Unknown"
        );
        const coverId = result.map((book) => book.cover_i);
        console.log(coverId);
        return {
          bookTitle: bookTitle,
          bookAuthor: bookAuthor,
          coverId: coverId,
        };
      } catch (error) {
        console.error("Error fetching data: ", error);
      }
    }

    //Way to eneter book details into databse.

    try {
      const bookTitleValue = bookTitle[0];
      if (bookTitleValue) {
      const BookCheck = await db.query(
        "SELECT * FROM book WHERE bookname = $1",
        [bookTitleValue]
      );
      if (BookCheck.rows.length > 0) {
        Errmessage = "This Book Has Already Been Added";
      } else {
        const bookAuthorValue = bookAuthor[0];
        const coverIdValue = coverId[0]; //The Value of coverId was returning a string array so we took only 1st value.
        await db.query(
          "INSERT INTO book (bookname,author,coverid) VALUES ($1,$2,$3)",
          [bookTitleValue, bookAuthorValue, coverIdValue]
        );
      }
    } else {
      Errmessage = "No Book Title Found";
    } 
  } catch (error) {
      console.error("Error checking existence in the database:", error);
      res.status(500).send("Internal Server Error");
    }

    res.render("add.ejs", {
      title: bookTitle,
      author: bookAuthor,
      cover: coverId,
      showAdditionalInput: true,
      Errmessage,
    });

  } catch (error) {
    res.status(500).send("Internal Server Error");
  }
});

//Route to add the data from add book page to home page by clicking button.
app.post("/addbook", async (req, res) => {
  let Errmessage = "";
  const BookReview = req.body.BookReview;

  try {
    if (BookReview.length > 0) {
      // Insert the book review into the book_review table
      await db.query(
        "INSERT INTO book_review (book_id, review) VALUES ((SELECT MAX(id) FROM book), $1)",
        [BookReview]
      );
      
      res.redirect("/");
    } else {
      Errmessage = "Oops! You Forgot to Write Your Learnings.";
      res.render("add.ejs", { Errmessage });
    }
  } catch (error) {
    console.error("Error inserting book review:", error);
    res.status(500).send("Internal Server Error");
  }
});

// To display details of the book when specific book is selected.
app.get ("/bookdetail/:id", async(req,res) => {
  try {
    const CurrentBookId = req.params.id;

    const bookResult = await db.query ("SELECT * FROM book WHERE id = $1", [CurrentBookId]);
    const book = bookResult.rows[0];

    const reviewResult = await db.query ("Select * FROM book_review WHERE book_id = $1", [CurrentBookId]);
    const bookReview = reviewResult.rows[0];

    res.render ("bookdetail.ejs", {book , bookReview});
  } catch (error) {
    console.error("Error fetching book details:", error);
    res.status(500).send("Internal Server Error");
  };
});

//To delete book and review from database
app.post("/delete-book", async (req, res) => {
  const id = req.body.id; 
  console.log(id);
  try {
    await db.query("DELETE FROM book_review WHERE book_id = $1", [id]);
    await db.query("DELETE FROM book WHERE id = $1", [id]);
    res.redirect("/");
  } catch (error) {
    console.error("Error deleting book:", error);
    res.status(500).send("Internal Server Error");
  }
});

// To upadate the learnings
app.post("/update-learnings", async (req, res) => {
  const id = req.body.id;
  const updatedReview = req.body.updatedReview;

  try {
    await db.query("UPDATE book_review SET review = $1 WHERE book_id = $2", [updatedReview, id]);
    res.redirect(`/bookdetail/${id}`); // Redirect to the same book detail page after updating
  } catch (error) {
    console.error("Error updating learnings:", error);
    res.status(500).send("Internal Server Error");
  }
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
