import pandas as pd
import os

# Load the CSV file
def make_csv():
    for i in range(1,95):
        df = pd.read_excel(f"y{i:03}.xls")
        df.to_csv(f"y{i:03}.csv", index=False)
    print("make csv done!")

def remove_xls_files():
    for i in range(1,95):
        df = os.remove(f"y{i:03}.xls")
    print("removal done!")  

remove_xls_files()