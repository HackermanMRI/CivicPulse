from app.database import Base, engine
import app.models  # noqa: F401


def main():
    Base.metadata.create_all(bind=engine)
    print("All tables created successfully.")


if __name__ == "__main__":
    main()